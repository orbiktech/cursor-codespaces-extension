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
			// Use shell to ensure proper PATH resolution on Linux
			await execAsync('gh --version', { shell: process.platform === 'win32' ? undefined : '/bin/sh' });
			return true;
		} catch {
			return false;
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
				{ 
					encoding: 'utf-8',
					shell: process.platform === 'win32' ? undefined : '/bin/sh'
				}
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
			    errorMessage.includes('you are not logged into any github hosts') ||
			    errorMessage.includes('please run: gh auth login') ||
			    errorMessage.includes('gh auth login') ||
			    (errorMessage.includes('to get started') && errorMessage.includes('gh auth login'))) {
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
	 * Start a codespace using GitHub API
	 */
	async startCodespace(codespaceName: string): Promise<void> {
		// Sanitize codespace name to prevent command injection
		if (!/^[a-zA-Z0-9_-]+$/.test(codespaceName)) {
			throw new Error('Invalid codespace name format');
		}

		try {
			// Use GitHub API to start the codespace
			// Format: POST /user/codespaces/{codespace_name}/start
			await execAsync(
				`gh api -X POST user/codespaces/${codespaceName}/start`,
				{ 
					encoding: 'utf-8',
					shell: process.platform === 'win32' ? undefined : '/bin/sh'
				}
			);
		} catch (error: any) {
			const errorMessage = error.stderr || error.message || '';
			
			// If codespace is already running, that's fine
			if (errorMessage.includes('already running') || errorMessage.includes('already started')) {
				return;
			}
			
			throw new Error(`Failed to start codespace: ${error.message}`);
		}
	}

	/**
	 * Check if codespace is available, and start it if needed, then wait for it
	 * @param progress Optional progress reporter to update status
	 */
	async ensureCodespaceAvailable(
		codespaceName: string,
		progress?: { report: (value: { message?: string; increment?: number }) => void }
	): Promise<void> {
		// Sanitize codespace name to prevent command injection
		if (!/^[a-zA-Z0-9_-]+$/.test(codespaceName)) {
			throw new Error('Invalid codespace name format');
		}

		// First, check current state and start if needed
		const codespaces = await this.listCodespaces();
		const codespace = codespaces.find(cs => cs.name === codespaceName);
		
		if (codespace && codespace.state === 'Shutdown') {
			// Start the codespace
			if (progress) {
				progress.report({ message: 'Starting codespace...' });
			}
			try {
				await this.startCodespace(codespaceName);
			} catch (error: any) {
				// If start fails, still try to proceed - SSH might trigger it
				console.warn(`Failed to start codespace via API: ${error.message}. Will attempt SSH connection anyway.`);
			}
		}

		// Poll to check if codespace becomes available
		const maxAttempts = 150; // 5 minutes (150 * 2 seconds = 300 seconds)
		const pollInterval = 2000; // 2 seconds
		
		for (let attempt = 0; attempt < maxAttempts; attempt++) {
			const codespaces = await this.listCodespaces();
			const codespace = codespaces.find(cs => cs.name === codespaceName);
			
			// Update progress message with current state
			if (progress) {
				if (codespace) {
					progress.report({ 
						message: `Waiting for codespace... Current state: ${codespace.state} (${attempt + 1}/${maxAttempts})` 
					});
				} else {
					progress.report({ 
						message: `Waiting for codespace... Checking status (${attempt + 1}/${maxAttempts})` 
					});
				}
			}
			
			// Only return when codespace is actually Available
			if (codespace && codespace.state === 'Available') {
				return;
			}
			
			// If codespace is in Shutdown or Unknown state, it might be starting
			// Continue polling until it becomes Available
			if (codespace && (codespace.state === 'Shutdown' || codespace.state === 'Unknown')) {
				await new Promise(resolve => setTimeout(resolve, pollInterval));
				continue;
			}
			
			// If codespace is in a transitional state (like "Starting"), continue waiting
			if (codespace && codespace.state !== 'Available') {
				await new Promise(resolve => setTimeout(resolve, pollInterval));
				continue;
			}
			
			// If codespace not found, wait and check again
			await new Promise(resolve => setTimeout(resolve, pollInterval));
		}
		
		// After max attempts, throw an error so user knows it's taking too long
		const timeoutMinutes = maxAttempts * pollInterval / 60000; // Convert to minutes
		throw new Error(
			`Codespace did not become available within ${timeoutMinutes} minutes. ` +
			`Current state may be: ${(await this.listCodespaces()).find(cs => cs.name === codespaceName)?.state || 'Unknown'}. ` +
			`The codespace may still be starting - you can try connecting again in a moment.`
		);
	}

	/**
	 * Generate SSH configuration for a codespace
	 */
	async generateSshConfig(codespaceName: string): Promise<string> {
		// Sanitize codespace name to prevent command injection
		// Only allow alphanumeric, hyphens, and underscores
		if (!/^[a-zA-Z0-9_-]+$/.test(codespaceName)) {
			throw new Error('Invalid codespace name format');
		}

		try {
			const { stdout } = await execAsync(
				`gh codespace ssh --config -c ${codespaceName}`,
				{ 
					encoding: 'utf-8',
					shell: process.platform === 'win32' ? undefined : '/bin/sh'
				}
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

