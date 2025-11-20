import * as vscode from 'vscode';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

export interface Codespace {
	name: string;
	displayName: string;
	state: string;
	lastUsedAt?: string;
	repository: string;
}

export class GhService {
	private static instance: GhService;

	private constructor() {}

	public static getInstance(): GhService {
		if (!GhService.instance) {
			GhService.instance = new GhService();
		}
		return GhService.instance;
	}

	/**
	 * Check if GitHub CLI is installed
	 */
	async checkGhInstalled(): Promise<boolean> {
		try {
			await execAsync('gh --version');
			return true;
		} catch {
			return false;
		}
	}

	/**
	 * Check if user is authenticated with GitHub CLI
	 */
	async checkAuth(): Promise<{ authenticated: boolean; missingScopes?: string[] }> {
		try {
			// Try to list codespaces directly - this is the most reliable check
			// If this works, user is authenticated and has the right scopes
			await execAsync('gh codespace list --limit 1', { encoding: 'utf-8' });
			return { authenticated: true };
		} catch (error: any) {
			const errorMessage = (error.stderr || error.stdout || error.message || '').toLowerCase();
			
			// Only treat as scope error if the message explicitly mentions scope/permission issues
			// Be very specific to avoid false positives
			if (errorMessage.includes('required scope') || 
			    errorMessage.includes('missing required scope') ||
			    (errorMessage.includes('needs the') && errorMessage.includes('scope')) ||
			    errorMessage.includes('needs the "codespace" scope') ||
			    (errorMessage.includes('insufficient') && errorMessage.includes('scope')) ||
			    (errorMessage.includes('403') && errorMessage.includes('scope'))) {
				const missingScopes = ['codespace'];
				return { authenticated: false, missingScopes };
			}
			
			// Check if it's a clear "not logged in" error
			if (errorMessage.includes('not logged in') || 
			    errorMessage.includes('authentication required') ||
			    errorMessage.includes('you are not logged into any github hosts') ||
			    errorMessage.includes('no oauth token')) {
				return { authenticated: false };
			}
			
			// For any other error, assume user might be authenticated but there's a different issue
			// Don't prompt for scope refresh unless we're certain
			// Try a simple API call as a fallback
			try {
				await execAsync('gh api user', { encoding: 'utf-8' });
				return { authenticated: true };
			} catch {
				// If we can't determine, assume not authenticated but don't assume scope issue
				return { authenticated: false };
			}
		}
	}

	/**
	 * Prompt user to login via terminal
	 */
	async promptLogin(): Promise<void> {
		const action = await vscode.window.showInformationMessage(
			'GitHub CLI authentication required. Open terminal to login?',
			'Open Terminal',
			'Cancel'
		);

		if (action === 'Open Terminal') {
			const terminal = vscode.window.createTerminal('GitHub CLI Login');
			terminal.sendText('gh auth login');
			terminal.show();
			await vscode.window.showInformationMessage(
				'Please complete the GitHub login in the terminal, then try connecting again.'
			);
		}
	}

	/**
	 * Prompt user to refresh scopes
	 */
	async promptRefreshScopes(): Promise<void> {
		const action = await vscode.window.showInformationMessage(
			'Additional GitHub scopes required for Codespaces. Refresh authentication?',
			'Refresh Scopes',
			'Cancel'
		);

		if (action === 'Refresh Scopes') {
			const terminal = vscode.window.createTerminal('GitHub CLI Auth Refresh');
			terminal.sendText('gh auth refresh -h github.com -s codespace');
			terminal.show();
			await vscode.window.showInformationMessage(
				'Please complete the scope refresh in the terminal, then try connecting again.'
			);
		}
	}

	/**
	 * List all available codespaces
	 */
	async listCodespaces(): Promise<Codespace[]> {
		try {
			const { stdout, stderr } = await execAsync(
				'gh codespace list --json name,displayName,state,lastUsedAt,repository',
				{ encoding: 'utf-8' }
			);
			
			// Empty output means no codespaces, which is valid
			if (!stdout || stdout.trim() === '') {
				return [];
			}
			
			const codespaces: Codespace[] = JSON.parse(stdout);
			return codespaces;
		} catch (error: any) {
			// Combine stderr, stdout, and message to catch all error information
			const errorMessage = (error.stderr || error.stdout || error.message || '').toLowerCase();
			
			// If it's an auth error, throw a specific error type
			if (errorMessage.includes('not logged in') || 
			    errorMessage.includes('authentication required') ||
			    errorMessage.includes('you are not logged into any github hosts')) {
				const authError = new Error('AUTHENTICATION_REQUIRED');
				authError.name = 'AuthenticationError';
				throw authError;
			}
			
			// If it's a scope/permission error - be very specific to avoid false positives
			if (errorMessage.includes('required scope') || 
			    errorMessage.includes('missing required scope') ||
			    (errorMessage.includes('needs the') && errorMessage.includes('scope')) ||
			    errorMessage.includes('needs the "codespace" scope') ||
			    (errorMessage.includes('insufficient') && errorMessage.includes('scope')) ||
			    (errorMessage.includes('permission') && errorMessage.includes('codespace')) ||
			    (errorMessage.includes('403') && errorMessage.includes('scope'))) {
				const scopeError = new Error('SCOPE_REQUIRED');
				scopeError.name = 'ScopeError';
				throw scopeError;
			}
			
			// For other errors, throw generic error
			throw new Error(`Failed to list codespaces: ${error.message}`);
		}
	}

	/**
	 * Check if codespace is available, and wait for it if it's starting
	 * Note: GitHub CLI doesn't have a 'start' command - codespaces start automatically
	 * when accessed via SSH, but we can check the state and wait if needed
	 */
	async ensureCodespaceAvailable(codespaceName: string): Promise<void> {
		// Poll to check if codespace becomes available
		// Codespaces may be starting or may start automatically when SSH is attempted
		const maxAttempts = 30;
		const pollInterval = 2000; // 2 seconds
		
		for (let attempt = 0; attempt < maxAttempts; attempt++) {
			const codespaces = await this.listCodespaces();
			const codespace = codespaces.find(cs => cs.name === codespaceName);
			
			if (codespace && codespace.state === 'Available') {
				return;
			}
			
			// If codespace is not found or in a transitional state, wait a bit
			// It might be starting automatically
			if (codespace && (codespace.state === 'Shutdown' || codespace.state === 'Unknown')) {
				// Codespace might be starting - wait and check again
				await new Promise(resolve => setTimeout(resolve, pollInterval));
				continue;
			}
			
			// If codespace is available or in another state, proceed
			// SSH connection will handle starting if needed
			if (codespace) {
				return;
			}
			
			await new Promise(resolve => setTimeout(resolve, pollInterval));
		}
		
		// Don't throw error - codespace might start automatically when SSH is attempted
		// Just log a warning
		console.warn(`Codespace ${codespaceName} may not be available yet, but will attempt connection anyway`);
	}

	/**
	 * Generate SSH configuration for a codespace
	 */
	async generateSshConfig(codespaceName: string): Promise<string> {
		try {
			const { stdout } = await execAsync(
				`gh codespace ssh --config -c ${codespaceName}`
			);
			return stdout;
		} catch (error: any) {
			const errorMessage = error.stderr || error.message || '';
			
			// Check if it's an SSHD error
			if (errorMessage.includes('sshd') || errorMessage.includes('SSH')) {
				throw new Error('SSHD_NOT_CONFIGURED');
			}
			
			throw new Error(`Failed to generate SSH config: ${error.message}`);
		}
	}

	/**
	 * Ensure GitHub CLI is installed and user is authenticated
	 */
	async ensureReady(): Promise<boolean> {
		// Check if gh is installed
		const ghInstalled = await this.checkGhInstalled();
		if (!ghInstalled) {
			await vscode.window.showErrorMessage(
				'GitHub CLI (gh) is not installed. Please install it from https://cli.github.com/'
			);
			return false;
		}

		// Try to list codespaces - this will fail if not authenticated or missing scopes
		// This is more reliable than checking auth status separately
		try {
			await this.listCodespaces();
			// If we can list codespaces (even if empty), we're authenticated and have the right scopes
			return true;
		} catch (error: any) {
			// Handle specific error types from listCodespaces
			if (error.name === 'AuthenticationError' || error.message === 'AUTHENTICATION_REQUIRED') {
				await this.promptLogin();
				return false;
			}
			
			if (error.name === 'ScopeError' || error.message === 'SCOPE_REQUIRED') {
				await this.promptRefreshScopes();
				return false;
			}
			
			// For other errors, don't assume it's an auth/scope issue
			// Just log the error and let the user proceed - they might have codespaces
			// The picker will handle "no codespaces" gracefully
			console.warn('Unexpected error listing codespaces:', error.message);
			// Assume user is authenticated and let them try - worst case they'll see an error in the picker
			return true;
		}
	}
}

