import * as vscode from 'vscode';
import { exec } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs';
import * as os from 'os';

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
	 * Stop a codespace using GitHub API
	 */
	async stopCodespace(codespaceName: string): Promise<void> {
		// Sanitize codespace name to prevent command injection
		if (!/^[a-zA-Z0-9_-]+$/.test(codespaceName)) {
			throw new Error('Invalid codespace name format');
		}

		try {
			// Use GitHub API to stop the codespace
			// Format: POST /user/codespaces/{codespace_name}/stop
			await execAsync(
				`gh api -X POST user/codespaces/${codespaceName}/stop`,
				{ 
					encoding: 'utf-8',
					shell: process.platform === 'win32' ? undefined : '/bin/sh'
				}
			);
		} catch (error: any) {
			const errorMessage = error.stderr || error.message || '';
			
			// If codespace is already stopped, that's fine
			if (errorMessage.includes('already stopped') || errorMessage.includes('not running')) {
				return;
			}
			
			throw new Error(`Failed to stop codespace: ${error.message}`);
		}
	}

	/**
	 * Delete a codespace using GitHub API
	 */
	async deleteCodespace(codespaceName: string): Promise<void> {
		// Sanitize codespace name to prevent command injection
		if (!/^[a-zA-Z0-9_-]+$/.test(codespaceName)) {
			throw new Error('Invalid codespace name format');
		}

		try {
			// Use GitHub API to delete the codespace
			// Format: DELETE /user/codespaces/{codespace_name}
			await execAsync(
				`gh api -X DELETE user/codespaces/${codespaceName}`,
				{ 
					encoding: 'utf-8',
					shell: process.platform === 'win32' ? undefined : '/bin/sh'
				}
			);
		} catch (error: any) {
			throw new Error(`Failed to delete codespace: ${error.message}`);
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
	 * On Linux, this also ensures SSH keys are generated
	 */
	async generateSshConfig(codespaceName: string): Promise<string> {
		// Sanitize codespace name to prevent command injection
		// Only allow alphanumeric, hyphens, and underscores
		if (!/^[a-zA-Z0-9_-]+$/.test(codespaceName)) {
			throw new Error('Invalid codespace name format');
		}

		try {
			// First, get the SSH config to see what key file it references
			const { stdout: sshConfig } = await execAsync(
				`gh codespace ssh --config -c ${codespaceName}`,
				{ 
					encoding: 'utf-8',
					shell: process.platform === 'win32' ? undefined : '/bin/sh'
				}
			);

			// On Linux, check if the key file exists
			// Extract IdentityFile from the config
			const identityFileMatch = sshConfig.match(/IdentityFile\s+(.+)/);
			if (identityFileMatch && process.platform !== 'win32') {
				const keyPath = identityFileMatch[1].trim();
				const expandedKeyPath = keyPath.replace(/^~/, os.homedir());
				
				// Check if the key file exists
				if (!fs.existsSync(expandedKeyPath)) {
					// Key file doesn't exist - trigger key generation by running a test SSH command
					// This will cause GitHub CLI to generate the keys
					try {
						// Run a quick command that will trigger key generation
						// Use timeout to prevent hanging, and we'll ignore the result
						await execAsync(
							`timeout 5 gh codespace ssh -c ${codespaceName} -- echo "key-check" 2>&1 || true`,
							{ 
								encoding: 'utf-8',
								shell: '/bin/sh',
								timeout: 6000 // 6 second timeout
							}
						);
					} catch {
						// Ignore errors - we just want to trigger key generation
						// The keys should now exist even if the connection failed
					}
					
					// Verify the key file was created
					if (!fs.existsSync(expandedKeyPath)) {
						throw new Error(
							`SSH key file not found: ${expandedKeyPath}. ` +
							`GitHub CLI may not have generated the keys. ` +
							`Try running 'gh codespace ssh -c ${codespaceName}' manually to generate keys.`
						);
					}
				}
			}

			return sshConfig;
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
	 * List recent repositories the user has access to (for initial display)
	 */
	async listRecentRepositories(limit: number = 10): Promise<{ nameWithOwner: string; description: string }[]> {
		try {
			const { stdout } = await execAsync(
				`gh repo list --json nameWithOwner,description --limit ${limit}`,
				{ 
					encoding: 'utf-8',
					shell: process.platform === 'win32' ? undefined : '/bin/sh'
				}
			);
			
			if (!stdout || stdout.trim() === '') {
				return [];
			}
			
			return JSON.parse(stdout);
		} catch (error: any) {
			throw new Error(`Failed to list repositories: ${error.message}`);
		}
	}

	/**
	 * Search repositories by name using GitHub API
	 */
	async searchRepositories(query: string): Promise<{ nameWithOwner: string; description: string }[]> {
		if (!query || query.trim().length < 2) {
			// For very short queries, just return recent repos
			return this.listRecentRepositories(10);
		}

		try {
			// Search user's repos using GitHub API
			// This searches across all repos the user has access to
			const { stdout } = await execAsync(
				`gh api "search/repositories?q=${encodeURIComponent(query)}+user:@me+fork:true&per_page=20" --jq ".items | map({nameWithOwner: .full_name, description: .description})"`,
				{ 
					encoding: 'utf-8',
					shell: process.platform === 'win32' ? undefined : '/bin/sh'
				}
			);
			
			if (!stdout || stdout.trim() === '' || stdout.trim() === '[]') {
				// If no results from user search, try org/all repos search
				const { stdout: allReposStdout } = await execAsync(
					`gh api "search/repositories?q=${encodeURIComponent(query)}+in:name&per_page=20" --jq ".items | map({nameWithOwner: .full_name, description: .description})"`,
					{ 
						encoding: 'utf-8',
						shell: process.platform === 'win32' ? undefined : '/bin/sh'
					}
				);
				
				if (!allReposStdout || allReposStdout.trim() === '' || allReposStdout.trim() === '[]') {
					return [];
				}
				
				return JSON.parse(allReposStdout);
			}
			
			return JSON.parse(stdout);
		} catch (error: any) {
			console.warn(`Failed to search repositories: ${error.message}`);
			// Fallback to listing repos if search fails
			return this.listRecentRepositories(10);
		}
	}

	/**
	 * List recent branches for a repository (limited for initial display)
	 */
	async listRecentBranches(repo: string, limit: number = 10): Promise<string[]> {
		try {
			const { stdout } = await execAsync(
				`gh api "repos/${repo}/branches?per_page=${limit}" --jq ".[].name"`,
				{ 
					encoding: 'utf-8',
					shell: process.platform === 'win32' ? undefined : '/bin/sh'
				}
			);
			
			if (!stdout || stdout.trim() === '') {
				return ['main', 'master']; // Fallback to common defaults
			}
			
			return stdout.trim().split('\n').filter(b => b.length > 0);
		} catch (error: any) {
			// If we can't list branches, return common defaults
			console.warn(`Failed to list branches for ${repo}: ${error.message}`);
			return ['main', 'master'];
		}
	}

	/**
	 * Search branches for a repository by name
	 * Uses pagination to fetch ALL branches, then filters client-side
	 */
	async searchBranches(repo: string, query: string): Promise<string[]> {
		if (!query || query.trim().length < 1) {
			return this.listRecentBranches(repo, 10);
		}

		try {
			// Use --paginate to get ALL branches (GitHub API doesn't support branch search)
			const { stdout } = await execAsync(
				`gh api "repos/${repo}/branches?per_page=100" --paginate --jq ".[].name"`,
				{ 
					encoding: 'utf-8',
					shell: process.platform === 'win32' ? undefined : '/bin/sh',
					timeout: 30000 // 30 second timeout for large repos
				}
			);
			
			if (!stdout || stdout.trim() === '') {
				return [];
			}
			
			const allBranches = stdout.trim().split('\n').filter(b => b.length > 0);
			const lowerQuery = query.toLowerCase();
			
			// Filter branches that match the query
			const filtered = allBranches.filter(branch => 
				branch.toLowerCase().includes(lowerQuery)
			);
			
			// Return top 50 matches to avoid overwhelming the UI
			return filtered.slice(0, 50);
		} catch (error: any) {
			console.warn(`Failed to search branches for ${repo}: ${error.message}`);
			return [];
		}
	}

	/**
	 * List available machine types for a repository
	 */
	async listMachineTypes(repo: string): Promise<{ name: string; displayName: string; cpus: number; memoryInGb: number }[]> {
		try {
			const { stdout } = await execAsync(
				`gh api "repos/${repo}/codespaces/machines" --jq ".machines | map({name: .name, displayName: .display_name, cpus: .cpus, memoryInGb: .memory_in_bytes / 1073741824})"`,
				{ 
					encoding: 'utf-8',
					shell: process.platform === 'win32' ? undefined : '/bin/sh'
				}
			);
			
			if (!stdout || stdout.trim() === '' || stdout.trim() === 'null') {
				return [];
			}
			
			return JSON.parse(stdout);
		} catch (error: any) {
			console.warn(`Failed to list machine types for ${repo}: ${error.message}`);
			return [];
		}
	}

	/**
	 * Create a new codespace
	 * Returns immediately after creation starts - does not wait for it to be fully available
	 */
	async createCodespace(
		repo: string,
		branch?: string,
		machine?: string
	): Promise<Codespace> {
		// Build the command - no --status flag so it returns immediately
		let command = `gh codespace create --repo ${repo}`;
		
		if (branch) {
			command += ` --branch ${branch}`;
		}
		
		if (machine) {
			command += ` --machine ${machine}`;
		}

		try {
			const { stdout } = await execAsync(
				command,
				{ 
					encoding: 'utf-8',
					shell: process.platform === 'win32' ? undefined : '/bin/sh',
					timeout: 60000 // 1 minute timeout - creation request should be quick
				}
			);
			
			// The command outputs the codespace name
			const codespaceName = stdout.trim();
			
			if (!codespaceName) {
				throw new Error('No codespace name returned from creation command');
			}

			// Return a codespace object - it will be in "Starting" state
			// The connect flow will handle waiting for it to become available
			return {
				name: codespaceName,
				displayName: codespaceName,
				state: 'Starting',
				repository: repo
			};
		} catch (error: any) {
			const errorMessage = error.stderr || error.message || '';
			
			if (errorMessage.includes('already exists')) {
				throw new Error('A codespace already exists for this repository and branch. Please use an existing codespace or delete it first.');
			}
			
			if (errorMessage.includes('billing') || errorMessage.includes('limit')) {
				throw new Error('Unable to create codespace. You may have reached your codespace limit or there may be billing issues.');
			}
			
			throw new Error(`Failed to create codespace: ${error.message}`);
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

