import * as vscode from 'vscode';
import { GhService } from './ghService';
import { SshConfigManager } from './sshConfig';
import { CodespacePicker } from './codespacePicker';
import { RemoteSshBridge } from './remoteSsh';
import { DevcontainerFixer } from './devcontainerFixer';

export function activate(context: vscode.ExtensionContext) {
	console.log('Cursor Codespaces extension is now active!');

	// Main connect command
	const connectCommand = vscode.commands.registerCommand(
		'cursorCodespaces.connect',
		async () => {
			await connectToCodespace();
		}
	);

	context.subscriptions.push(connectCommand);

	// Create status bar item
	const statusBarItem = vscode.window.createStatusBarItem(
		vscode.StatusBarAlignment.Right,
		100
	);
	statusBarItem.command = 'cursorCodespaces.connect';
	statusBarItem.text = '$(remote) Connect to Codespace';
	statusBarItem.tooltip = 'Connect to a GitHub Codespace';
	statusBarItem.show();

	context.subscriptions.push(statusBarItem);
}

async function connectToCodespace(): Promise<void> {
	const ghService = GhService.getInstance();
	const sshConfigManager = SshConfigManager.getInstance();
	const codespacePicker = CodespacePicker.getInstance();
	const remoteSshBridge = RemoteSshBridge.getInstance();
	const devcontainerFixer = DevcontainerFixer.getInstance();

	try {
		// Step 1: Ensure GitHub CLI is ready
		const isReady = await ghService.ensureReady();
		if (!isReady) {
			return;
		}

		// Step 2: Check if Remote-SSH is available
		// In Cursor, Remote-SSH is built-in, so this should always pass
		const remoteSshAvailable = await remoteSshBridge.checkRemoteSshAvailable();
		if (!remoteSshAvailable) {
			await vscode.window.showErrorMessage(
				'Remote-SSH is not available. ' +
				'In Cursor, Remote-SSH is built-in. ' +
				'If you are using VS Code, please install the Remote-SSH extension from the marketplace.'
			);
			return;
		}

		// Step 3: Pick a codespace (always fetch fresh list)
		// Refresh codespace list to get latest status
		const codespace = await codespacePicker.pickCodespace();
		if (!codespace) {
			return;
		}

		// Step 4: Ensure codespace is available (wait if it's starting)
		// Note: Codespaces may start automatically when accessed via SSH
		// Always check latest status, as codespace state may have changed
		let latestCodespace = codespace;
		const allCodespaces = await ghService.listCodespaces();
		const updatedCodespace = allCodespaces.find(cs => cs.name === codespace.name);
		if (updatedCodespace) {
			latestCodespace = updatedCodespace;
		}

		if (latestCodespace.state !== 'Available') {
			await vscode.window.withProgress(
				{
					location: vscode.ProgressLocation.Notification,
					title: 'Waiting for codespace to be available...',
					cancellable: false
				},
				async (progress) => {
					await ghService.ensureCodespaceAvailable(codespace.name, progress);
				}
			);
			
			// After waiting, refresh the codespace status one more time
			const refreshedCodespaces = await ghService.listCodespaces();
			const refreshedCodespace = refreshedCodespaces.find(cs => cs.name === codespace.name);
			if (refreshedCodespace) {
				latestCodespace = refreshedCodespace;
			}
		}

		// Step 5: Generate SSH config
		let sshConfig: string;
		try {
			sshConfig = await ghService.generateSshConfig(codespace.name);
		} catch (error: any) {
			if (error.message === 'SSHD_NOT_CONFIGURED') {
				await devcontainerFixer.offerSshdFix();
				return;
			}
			throw error;
		}

		// Step 6: Prepare repository-based host name
		// Repository format: "owner/repo-name" (e.g., "github-org/my-repo")
		if (!codespace.repository || !codespace.repository.includes('/')) {
			throw new Error(`Invalid repository format: ${codespace.repository}. Expected format: owner/repo-name`);
		}

		const repoName = codespace.repository.replace('/', '-'); // For SSH Host: "owner-repo-name"
		// For workspace path, we need just the repo name (the part after the slash)
		const simpleRepoName = codespace.repository.split('/')[1]; // Just "repo-name" (e.g., "my-repo")
		
		if (!simpleRepoName) {
			throw new Error(`Invalid repository format: ${codespace.repository}. Could not extract repo name.`);
		}
		
		// Modify SSH config to use repository name as Host (like the working extension)
		const modifiedSshConfig = sshConfig.replace(/^(Host\s+).*/m, `$1${repoName}`);

		// Step 7: Merge SSH config
		await vscode.window.withProgress(
			{
				location: vscode.ProgressLocation.Notification,
				title: 'Updating SSH configuration...',
				cancellable: false
			},
			async () => {
				await sshConfigManager.mergeConfig(modifiedSshConfig);
			}
		);

		// Step 8: Connect via Remote-SSH using the same approach as the working extension
		// Brief delay to ensure SSH config is recognized (already waited in remoteSsh.ts)
		
		// Use the same URI format as the working extension: vscode-remote://ssh-remote+${repoName}/workspaces/${simpleRepoName}
		await remoteSshBridge.connectToHost(repoName, simpleRepoName);
	} catch (error: any) {
		// Provide more user-friendly error messages
		let errorMessage = error.message || 'Unknown error occurred';
		
		if (errorMessage.includes('User declined')) {
			errorMessage = 'Connection cancelled. SSH config modification was declined.';
		} else if (errorMessage.includes('Invalid repository')) {
			errorMessage = `Invalid repository format. Please ensure your codespace has a valid repository (owner/repo-name format).`;
		} else if (errorMessage.includes('Invalid codespace name')) {
			errorMessage = 'Invalid codespace name format. Please try again.';
		} else if (errorMessage.includes('SSHD_NOT_CONFIGURED')) {
			errorMessage = 'SSHD is not configured in your Codespace. Please configure it in your devcontainer.';
		} else if (errorMessage.includes('AUTHENTICATION_REQUIRED')) {
			errorMessage = 'GitHub authentication required. Please login using `gh auth login`.';
		} else if (errorMessage.includes('SCOPE_REQUIRED')) {
			errorMessage = 'Additional GitHub scopes required. Please refresh authentication with `gh auth refresh -h github.com -s codespace`.';
		}
		
		await vscode.window.showErrorMessage(
			`Failed to connect to codespace: ${errorMessage}`
		);
	}
}

export function deactivate() {}
