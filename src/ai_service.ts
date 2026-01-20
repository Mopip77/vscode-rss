import * as cheerio from 'cheerio';
import { got } from './utils';

/**
 * Request structure for AI brief generation
 */
export interface AIBriefRequest {
    title: string;
    content: string;
}

/**
 * Generic AI service implementation that works with any streaming API
 */
export class AIService {
    constructor(
        private endpoint: string,
        private apiKey: string,
        private model: string
    ) {}

    async *streamBrief(request: AIBriefRequest): AsyncGenerator<string, void, unknown> {
        // Extract clean text from HTML
        const cleanContent = extractTextFromHTML(request.content);

        // Limit content to 10,000 characters to avoid excessive token usage
        const truncatedContent = cleanContent.substring(0, 10000);

        // Build the prompt
        const prompt = `You are a helpful assistant that summarizes articles.

Article Title: ${request.title}

Article Content:
${truncatedContent}

Please provide:
1. A brief overview paragraph (2-3 sentences)
2. 3-5 bulleted key points

Format your response in Markdown:
- Use bullet points (- or *) for key points
- Use **bold** for emphasis on key terms
- Keep it concise and scannable

Do NOT wrap your response in code blocks.`;

        // Detect API type based on endpoint
        const isGemini = this.endpoint.includes('generativelanguage.googleapis.com');
        const isOpenAI = this.endpoint.includes('openai.com') || this.endpoint.includes('api.openai.com');

        let requestBody: any;
        let url = this.endpoint;
        const headers: Record<string, string> = {
            'Content-Type': 'application/json'
        };

        if (isGemini) {
            // Gemini API format
            url = this.endpoint.replace('{model}', this.model) + `?key=${this.apiKey}`;
            requestBody = {
                contents: [{
                    parts: [{
                        text: prompt
                    }]
                }],
                generationConfig: {
                    temperature: 0.7,
                    maxOutputTokens: 1024
                }
            };
        } else {
            // OpenAI-compatible format (OpenAI, Claude via OpenAI SDK, etc.)
            headers['Authorization'] = `Bearer ${this.apiKey}`;
            requestBody = {
                model: this.model,
                messages: [{
                    role: 'user',
                    content: prompt
                }],
                temperature: 0.7,
                max_tokens: 1024,
                stream: true
            };
        }

        try {
            const response = await got.post(url, {
                json: requestBody,
                headers: headers,
                responseType: 'text',
                isStream: true,
                timeout: {
                    request: 30000
                }
            });

            let buffer = '';

            for await (const chunk of response) {
                buffer += chunk.toString();

                if (isGemini) {
                    // Gemini streaming format: newline-delimited JSON
                    const lines = buffer.split('\n');
                    buffer = lines.pop() || '';

                    for (const line of lines) {
                        if (!line.trim()) {
                            continue;
                        }

                        try {
                            const data = JSON.parse(line);

                            // Extract text from Gemini response format
                            if (data.candidates && data.candidates.length > 0) {
                                const candidate = data.candidates[0];
                                if (candidate.content && candidate.content.parts) {
                                    for (const part of candidate.content.parts) {
                                        if (part.text) {
                                            yield part.text;
                                        }
                                    }
                                }
                            }
                        } catch (parseError) {
                            // Skip malformed JSON lines
                            continue;
                        }
                    }
                } else {
                    // OpenAI-compatible SSE format: data: {...}
                    const lines = buffer.split('\n');
                    buffer = lines.pop() || '';

                    for (const line of lines) {
                        if (!line.trim() || !line.startsWith('data: ')) {
                            continue;
                        }

                        const data = line.substring(6); // Remove 'data: ' prefix

                        if (data === '[DONE]') {
                            continue;
                        }

                        try {
                            const parsed = JSON.parse(data);

                            // Extract text from OpenAI response format
                            if (parsed.choices && parsed.choices.length > 0) {
                                const delta = parsed.choices[0].delta;
                                if (delta && delta.content) {
                                    yield delta.content;
                                }
                            }
                        } catch (parseError) {
                            // Skip malformed JSON
                            continue;
                        }
                    }
                }
            }

            // Process any remaining data in buffer
            if (buffer.trim()) {
                try {
                    if (isGemini) {
                        const data = JSON.parse(buffer);
                        if (data.candidates && data.candidates.length > 0) {
                            const candidate = data.candidates[0];
                            if (candidate.content && candidate.content.parts) {
                                for (const part of candidate.content.parts) {
                                    if (part.text) {
                                        yield part.text;
                                    }
                                }
                            }
                        }
                    }
                } catch (parseError) {
                    // Ignore final parsing errors
                }
            }
        } catch (error: any) {
            if (error.response) {
                const statusCode = error.response.statusCode;
                if (statusCode === 401) {
                    throw new Error('Invalid API key. Please check your settings.');
                } else if (statusCode === 429) {
                    throw new Error('Rate limit exceeded. Please try again later.');
                } else if (statusCode === 400) {
                    throw new Error('Invalid request. Please check your endpoint and model configuration.');
                }
            }
            throw new Error(`Failed to generate brief: ${error.message}`);
        }
    }
}

/**
 * Extract plain text from HTML content
 */
export function extractTextFromHTML(html: string): string {
    const $ = cheerio.load(html);

    // Remove script, style, iframe, and other non-content elements
    $('script, style, iframe, noscript, nav, header, footer, aside').remove();

    // Get text content
    const text = $('body').text() || $.text();

    // Normalize whitespace
    return text.replace(/\s+/g, ' ').trim();
}

/**
 * Factory function to create AI service based on configuration
 * @param apiKey Optional API key (if already retrieved from SecretStorage)
 */
export function createAIService(endpoint: string, apiKey: string, model: string): AIService {
    return new AIService(endpoint, apiKey, model);
}
