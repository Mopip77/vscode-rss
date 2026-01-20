import * as vscode from 'vscode';
import { AIBriefRequest, createAIService, extractTextFromHTML } from './ai_service';
import { Abstract } from './content';
import { AIConfigManager } from './ai_config';
import remend from 'remend';
import { marked } from 'marked';

/**
 * Manages AI brief generation and display within article webviews
 */
export class AIBriefPanel {
    private briefCache: Map<string, string> = new Map();
    private generatingArticles: Set<string> = new Set();
    private configManager: AIConfigManager;

    constructor(context: vscode.ExtensionContext) {
        this.configManager = new AIConfigManager(context);
    }

    /**
     * Generate HTML for AI brief section to be injected into article webview
     */
    getHTML(): string {
        const enabled = vscode.workspace.getConfiguration('rss').get<boolean>('ai-brief-enabled');
        if (!enabled) {
            return '';
        }

        return `
        <div id="ai-brief-container" class="ai-brief-container">
            <div class="ai-brief-header" onclick="toggleAIBrief()">
                <span class="ai-brief-toggle">▶</span>
                <span class="ai-brief-title">✨ AI Brief</span>
            </div>
            <div id="ai-brief-content" class="ai-brief-content collapsed">
                <div id="brief-loading" class="brief-loading" style="display: none;">
                    <div class="spinner"></div>
                    <span>Generating AI brief...</span>
                </div>
                <div id="brief-result" class="brief-result" style="display: none;"></div>
                <div id="brief-error" class="brief-error" style="display: none;"></div>
            </div>
        </div>
        `;
    }

    /**
     * Get CSS styles for AI brief panel
     */
    getStyles(): string {
        return `
        /* AI Brief Panel Styles */
        .ai-brief-container {
            background-color: var(--vscode-editor-background);
            border: 1px solid var(--vscode-panel-border);
            border-radius: 4px;
            margin: 16px 0;
            max-width: 960px;
        }
        .ai-brief-header {
            display: flex;
            align-items: center;
            padding: 12px 16px;
            cursor: pointer;
            background-color: var(--vscode-editor-background);
            border-radius: 4px 4px 0 0;
            user-select: none;
        }
        .ai-brief-header:hover {
            background-color: var(--vscode-list-hoverBackground);
        }
        .ai-brief-toggle {
            margin-right: 8px;
            transition: transform 0.2s;
        }
        .ai-brief-title {
            font-weight: 500;
        }
        .ai-brief-content {
            padding: 0 16px;
            max-height: 0;
            overflow: hidden;
            transition: max-height 0.3s ease, padding 0.3s ease;
        }
        .ai-brief-content:not(.collapsed) {
            max-height: 800px;
            padding: 16px;
            overflow-y: auto;
        }
        .brief-loading {
            display: flex;
            align-items: center;
            gap: 12px;
            padding: 16px;
            color: var(--vscode-foreground);
        }
        .spinner {
            width: 16px;
            height: 16px;
            border: 2px solid var(--vscode-progressBar-background);
            border-top-color: transparent;
            border-radius: 50%;
            animation: spin 1s linear infinite;
        }
        @keyframes spin {
            to { transform: rotate(360deg); }
        }
        .brief-result {
            color: var(--vscode-foreground);
            line-height: 1.6;
        }
        /* Styling for AI-generated HTML content */
        .brief-result p {
            margin: 0 0 12px 0;
        }
        .brief-result ul, .brief-result ol {
            margin: 0 0 12px 0;
            padding-left: 24px;
        }
        .brief-result li {
            margin: 6px 0;
        }
        .brief-result h1, .brief-result h2, .brief-result h3 {
            margin: 16px 0 8px 0;
            font-weight: 600;
        }
        .brief-result h1 { font-size: 1.5em; }
        .brief-result h2 { font-size: 1.3em; }
        .brief-result h3 { font-size: 1.1em; }
        .brief-result strong {
            font-weight: 600;
        }
        .brief-result code {
            background-color: var(--vscode-textCodeBlock-background);
            padding: 2px 4px;
            border-radius: 3px;
            font-family: var(--vscode-editor-font-family);
        }
        .brief-error {
            padding: 12px;
            background-color: var(--vscode-inputValidation-errorBackground);
            border: 1px solid var(--vscode-inputValidation-errorBorder);
            border-radius: 4px;
            color: var(--vscode-errorForeground);
        }
        `;
    }

    /**
     * Get JavaScript code for AI brief client-side functionality
     */
    getScript(): string {
        return `
        let isAIBriefExpanded = false;
        let hasGeneratedBrief = false;

        function toggleAIBrief() {
            const content = document.getElementById('ai-brief-content');
            const toggle = document.querySelector('.ai-brief-toggle');

            if (content.classList.contains('collapsed')) {
                // Expanding
                content.classList.remove('collapsed');
                toggle.textContent = '▼';
                isAIBriefExpanded = true;

                // Auto-generate on first expand
                if (!hasGeneratedBrief) {
                    generateBrief();
                }
            } else {
                // Collapsing
                content.classList.add('collapsed');
                toggle.textContent = '▶';
                isAIBriefExpanded = false;
            }
        }

        function generateBrief() {
            hasGeneratedBrief = true;

            const loading = document.getElementById('brief-loading');
            const result = document.getElementById('brief-result');
            const error = document.getElementById('brief-error');

            result.style.display = 'none';
            result.innerHTML = '';
            error.style.display = 'none';
            loading.style.display = 'flex';

            vscode.postMessage({ type: 'generateBrief' });
        }

        window.addEventListener('message', event => {
            const message = event.data;

            switch (message.type) {
                case 'briefChunk':
                    const result = document.getElementById('brief-result');
                    const loading = document.getElementById('brief-loading');
                    loading.style.display = 'none';
                    result.style.display = 'block';
                    result.innerHTML = message.content;  // Replace with pre-rendered HTML
                    break;

                case 'briefComplete':
                    const resultComplete = document.getElementById('brief-result');
                    if (message.content) {
                        resultComplete.innerHTML = message.content;  // Final render
                    }
                    document.getElementById('brief-loading').style.display = 'none';
                    break;

                case 'briefError':
                    const loadingEl = document.getElementById('brief-loading');
                    const errorEl = document.getElementById('brief-error');
                    loadingEl.style.display = 'none';
                    errorEl.style.display = 'block';
                    errorEl.textContent = message.error;
                    hasGeneratedBrief = false; // Allow retry
                    break;

                case 'briefCached':
                    const resultEl = document.getElementById('brief-result');
                    const loadingEl2 = document.getElementById('brief-loading');
                    loadingEl2.style.display = 'none';
                    resultEl.style.display = 'block';
                    resultEl.innerHTML = message.content;
                    hasGeneratedBrief = true;
                    break;
            }
        });
        `;
    }

    /**
     * Render markdown content to HTML
     * Uses remend to complete incomplete markdown during streaming
     * @param content Raw markdown content
     * @param isFinal Whether this is the final render (no syntax completion needed)
     */
    private renderMarkdown(content: string, isFinal: boolean): string {
        // 1. Clean code block wrappers (AI sometimes wraps response in code blocks)
        let cleaned = content.trim();
        const match = cleaned.match(/^```(?:\w+)?\n?([\s\S]*?)(?:\n?```)?$/);
        if (match) {
            cleaned = match[1];
        }

        // 2. During streaming, use remend to complete incomplete markdown syntax
        if (!isFinal) {
            cleaned = remend(cleaned);
        }

        // 3. Convert markdown to HTML using marked
        return marked.parse(cleaned, { async: false }) as string;
    }

    /**
     * Handle webview messages related to AI brief
     * @returns true if message was handled, false otherwise
     */
    async handleMessage(
        message: any,
        panel: vscode.WebviewPanel,
        abstract: Abstract,
        getContent: () => Promise<string>
    ): Promise<boolean> {
        if (message.type === 'generateBrief') {
            await this.generateBrief(panel, abstract, getContent);
            return true;
        }
        return false;
    }

    /**
     * Generate AI brief for an article
     */
    private async generateBrief(
        panel: vscode.WebviewPanel,
        abstract: Abstract,
        getContent: () => Promise<string>
    ): Promise<void> {
        // Check cache first (cache stores raw markdown, render before sending)
        const cached = this.briefCache.get(abstract.id);
        if (cached) {
            const html = this.renderMarkdown(cached, true);
            panel.webview.postMessage({
                type: 'briefCached',
                content: html
            });
            return;
        }

        // Prevent duplicate generation
        if (this.generatingArticles.has(abstract.id)) {
            return;
        }

        this.generatingArticles.add(abstract.id);

        try {
            // Validate configuration
            const configValidation = await this.configManager.validateConfig();
            if (!configValidation.valid) {
                panel.webview.postMessage({
                    type: 'briefError',
                    error: configValidation.error || 'AI brief is not properly configured.'
                });
                return;
            }

            // Get configuration
            const apiKey = await this.configManager.getApiKey();
            const endpoint = this.configManager.getEndpoint();
            const model = this.configManager.getModel();

            if (!apiKey || !endpoint || !model) {
                panel.webview.postMessage({
                    type: 'briefError',
                    error: 'AI brief configuration is incomplete.'
                });
                return;
            }

            const aiService = createAIService(endpoint, apiKey, model);

            // Get article content
            const content = await getContent();
            const cleanContent = extractTextFromHTML(content);

            const request: AIBriefRequest = {
                title: abstract.title,
                content: cleanContent.substring(0, 10000) // Limit to 10k chars
            };

            let accumulatedContent = '';

            // Stream response with Node-side markdown rendering
            for await (const chunk of aiService.streamBrief(request)) {
                accumulatedContent += chunk;

                // Render accumulated markdown to HTML on Node side
                const html = this.renderMarkdown(accumulatedContent, false);

                panel.webview.postMessage({
                    type: 'briefChunk',
                    content: html  // Send pre-rendered HTML
                });
            }

            // Cache the raw markdown (not rendered HTML) for later retrieval
            this.briefCache.set(abstract.id, accumulatedContent);

            // Final render
            const finalHtml = this.renderMarkdown(accumulatedContent, true);
            panel.webview.postMessage({
                type: 'briefComplete',
                content: finalHtml
            });

        } catch (error: any) {
            panel.webview.postMessage({
                type: 'briefError',
                error: `Failed to generate brief: ${error.message}`
            });
        } finally {
            this.generatingArticles.delete(abstract.id);
        }
    }

    /**
     * Clear cache for a specific article or all articles
     */
    clearCache(articleId?: string): void {
        if (articleId) {
            this.briefCache.delete(articleId);
        } else {
            this.briefCache.clear();
        }
    }

    /**
     * Get cache size for monitoring
     */
    getCacheSize(): number {
        return this.briefCache.size;
    }
}
