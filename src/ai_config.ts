import * as vscode from 'vscode';

/**
 * Manages secure storage of AI service API keys using VSCode SecretStorage
 */
export class AIConfigManager {
    private static readonly SECRET_KEY = 'rss.ai-brief-api-key';
    private context: vscode.ExtensionContext;

    constructor(context: vscode.ExtensionContext) {
        this.context = context;
    }

    /**
     * Get API key from SecretStorage, fallback to settings if not found
     */
    async getApiKey(): Promise<string | undefined> {
        // Try SecretStorage first
        const secretKey = await this.context.secrets.get(AIConfigManager.SECRET_KEY);
        if (secretKey && secretKey.trim() !== '') {
            return secretKey;
        }

        // Fallback to settings.json for backward compatibility
        const settingsKey = vscode.workspace.getConfiguration('rss').get<string>('ai-brief-api-key');
        if (settingsKey && settingsKey.trim() !== '') {
            // Auto-migrate to SecretStorage
            await this.setApiKey(settingsKey);
            // Clear from settings
            await vscode.workspace.getConfiguration('rss').update('ai-brief-api-key', '', vscode.ConfigurationTarget.Global);
            return settingsKey;
        }

        return undefined;
    }

    /**
     * Store API key in SecretStorage
     */
    async setApiKey(apiKey: string): Promise<void> {
        if (!apiKey || apiKey.trim() === '') {
            await this.deleteApiKey();
            return;
        }
        await this.context.secrets.store(AIConfigManager.SECRET_KEY, apiKey);
    }

    /**
     * Delete API key from SecretStorage
     */
    async deleteApiKey(): Promise<void> {
        await this.context.secrets.delete(AIConfigManager.SECRET_KEY);
    }

    /**
     * Check if AI brief feature is enabled
     */
    isEnabled(): boolean {
        return vscode.workspace.getConfiguration('rss').get<boolean>('ai-brief-enabled', false);
    }

    /**
     * Get AI service endpoint URL
     */
    getEndpoint(): string | undefined {
        const endpoint = vscode.workspace.getConfiguration('rss').get<string>('ai-brief-endpoint');
        return endpoint && endpoint.trim() !== '' ? endpoint : undefined;
    }

    /**
     * Get AI model name
     */
    getModel(): string | undefined {
        const model = vscode.workspace.getConfiguration('rss').get<string>('ai-brief-model');
        return model && model.trim() !== '' ? model : undefined;
    }

    /**
     * Validate that all required configuration is present
     */
    async validateConfig(): Promise<{ valid: boolean; error?: string }> {
        if (!this.isEnabled()) {
            return { valid: false, error: 'AI brief feature is not enabled' };
        }

        const endpoint = this.getEndpoint();
        if (!endpoint) {
            return { valid: false, error: 'AI service endpoint is not configured' };
        }

        const apiKey = await this.getApiKey();
        if (!apiKey) {
            return { valid: false, error: 'API key is not configured. Please set it using the "RSS: Set AI API Key" command' };
        }

        const model = this.getModel();
        if (!model) {
            return { valid: false, error: 'AI model is not configured' };
        }

        return { valid: true };
    }

    /**
     * Prompt user to enter API key via secure input
     */
    async promptForApiKey(): Promise<boolean> {
        const apiKey = await vscode.window.showInputBox({
            prompt: 'Enter your AI service API key',
            password: true,
            placeHolder: 'sk-...',
            ignoreFocusOut: true,
            validateInput: (value) => {
                if (!value || value.trim() === '') {
                    return 'API key cannot be empty';
                }
                return null;
            }
        });

        if (apiKey) {
            await this.setApiKey(apiKey);
            vscode.window.showInformationMessage('API key saved securely');
            return true;
        }

        return false;
    }
}
