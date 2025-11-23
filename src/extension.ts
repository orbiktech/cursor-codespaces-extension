import * as vscode from 'vscode';
import { GhService } from './ghService';
import { SshConfigManager } from './sshConfig';
import { CodespacePicker } from './codespacePicker';
import { RemoteSshBridge } from './remoteSsh';
import { DevcontainerFixer } from './devcontainerFixer';
import { CodespaceExplorerProvider, CodespaceTreeItem } from './codespaceExplorer';
import { Codespace } from './ghService';

export function activate(context: vscode.ExtensionContext) {
	// Extension activated

	// Create codespace explorer
	const codespaceExplorerProvider = new CodespaceExplorerProvider();
	const treeView = vscode.window.createTreeView('codespacesExplorer', {
		treeDataProvider: codespaceExplorerProvider,
		showCollapseAll: false
	});

	// Refresh explorer when it becomes visible (e.g., when user first opens the sidebar)
	treeView.onDidChangeVisibility((e) => {
		if (e.visible) {
			// View became visible, refresh to ensure latest state is shown
			codespaceExplorerProvider.refresh();
		}
	});

	// Initial refresh to ensure view is populated on first activation
	// Use a small delay to ensure the view is ready
	setTimeout(() => {
		codespaceExplorerProvider.refresh();
	}, 100);

	context.subscriptions.push(treeView);
	context.subscriptions.push(codespaceExplorerProvider); // Dispose polling interval on deactivation

	// Main connect command (from command palette/status bar)
	const connectCommand = vscode.commands.registerCommand(
		'cursorCodespaces.connect',
		async () => {
			await connectToCodespace();
			// Refresh explorer after connecting
			codespaceExplorerProvider.refresh();
		}
	);

	context.subscriptions.push(connectCommand);

	// Connect from explorer
	const connectFromExplorerCommand = vscode.commands.registerCommand(
		'cursorCodespaces.connectToCodespaceFromExplorer',
		async (item: CodespaceTreeItem | Codespace) => {
			// Handle both tree item and codespace object
			let codespace: Codespace;
			if (item instanceof CodespaceTreeItem) {
				codespace = item.codespace;
			} else {
				codespace = item;
			}
			
			if (!codespace || !codespace.name) {
				await vscode.window.showErrorMessage(
					'Failed to get codespace information. Please try refreshing the explorer.'
				);
				return;
			}

			// Prevent multiple clicks - check if already connecting
			if (codespaceExplorerProvider.isConnecting(codespace.name)) {
				return; // Already connecting, ignore click
			}

			// Mark as connecting immediately for instant feedback
			codespaceExplorerProvider.setConnecting(codespace.name, true);
			
			try {
				await connectToCodespace(codespace);
			} finally {
				// Always clear connecting state and refresh
				codespaceExplorerProvider.setConnecting(codespace.name, false);
				codespaceExplorerProvider.refresh();
			}
		}
	);

	context.subscriptions.push(connectFromExplorerCommand);

	// Refresh explorer command
	const refreshExplorerCommand = vscode.commands.registerCommand(
		'cursorCodespaces.refreshExplorer',
		async () => {
			codespaceExplorerProvider.refresh();
		}
	);

	context.subscriptions.push(refreshExplorerCommand);

	// Open terminal with authentication command
	const openAuthTerminalCommand = vscode.commands.registerCommand(
		'cursorCodespaces.openAuthTerminal',
		async (command: string) => {
			const terminal = vscode.window.createTerminal('GitHub CLI Authentication');
			terminal.sendText(command);
			terminal.show();
			
			// Show message with refresh button (auto-refresh is also enabled)
			const action = await vscode.window.showInformationMessage(
				'Please complete the authentication in the terminal. The explorer will auto-refresh, or click "Refresh Now" to refresh immediately.',
				'Refresh Now'
			);
			
			if (action === 'Refresh Now') {
				codespaceExplorerProvider.refresh();
			}
		}
	);

	context.subscriptions.push(openAuthTerminalCommand);

	// Open Remote-SSH extension in marketplace
	const openRemoteSshExtensionCommand = vscode.commands.registerCommand(
		'cursorCodespaces.openRemoteSshExtension',
		async () => {
			try {
				// Try to use the installExtension command first
				await vscode.commands.executeCommand('workbench.extensions.installExtension', 'anysphere.remote-ssh');
				await vscode.window.showInformationMessage(
					'Installing Remote-SSH extension... The explorer will auto-refresh when installation completes, or click "Refresh Now" to refresh immediately.',
					'Refresh Now'
				).then(action => {
					if (action === 'Refresh Now') {
						codespaceExplorerProvider.refresh();
					}
				});
			} catch (error) {
				// Fallback: open extensions view with search
				await vscode.commands.executeCommand('workbench.view.extensions');
				await vscode.commands.executeCommand('workbench.extensions.search', 'anysphere.remote-ssh');
				await vscode.window.showInformationMessage(
					'Please install the Remote-SSH extension from the marketplace. The explorer will auto-refresh when installation completes, or click "Refresh Now" to refresh immediately.',
					'Refresh Now'
				).then(action => {
					if (action === 'Refresh Now') {
						codespaceExplorerProvider.refresh();
					}
				});
			}
		}
	);

	context.subscriptions.push(openRemoteSshExtensionCommand);

	// Switch to Anysphere Remote Containers extension
	const switchToAnysphereRemoteContainersCommand = vscode.commands.registerCommand(
		'cursorCodespaces.switchToAnysphereRemoteContainers',
		async () => {
			try {
				const extensions = vscode.extensions.all;
				const vscodeRemoteContainers = extensions.find(
					(ext: vscode.Extension<any>) => 
						ext.id === 'ms-vscode-remote.remote-containers'
				);

				// First, uninstall the incompatible extension if it exists
				if (vscodeRemoteContainers) {
					await vscode.window.showInformationMessage(
						'Uninstalling incompatible VSCode Remote Containers extension...',
						{ modal: false }
					);
					
					try {
						await vscode.commands.executeCommand(
							'workbench.extensions.uninstallExtension',
							'ms-vscode-remote.remote-containers'
						);
					} catch (error: any) {
						// If uninstall command doesn't work, show manual instructions
						await vscode.window.showWarningMessage(
							'Could not automatically uninstall the extension. Please manually uninstall "Remote - Containers" (ms-vscode-remote.remote-containers) from the Extensions view, then click "Switch to Anysphere Remote Containers" again.',
							'Open Extensions View'
						).then(action => {
							if (action === 'Open Extensions View') {
								vscode.commands.executeCommand('workbench.view.extensions');
							}
						});
						return;
					}
				}

				// Wait a moment for uninstall to complete
				await new Promise(resolve => setTimeout(resolve, 1000));

				// Now install the compatible extension
				await vscode.window.showInformationMessage(
					'Installing Anysphere Remote Containers extension...',
					{ modal: false }
				);

				try {
					await vscode.commands.executeCommand(
						'workbench.extensions.installExtension',
						'anysphere.remote-containers'
					);
					await vscode.window.showInformationMessage(
						'Successfully switched to Anysphere Remote Containers extension. The explorer will auto-refresh when installation completes, or click "Refresh Now" to refresh immediately.',
						'Refresh Now'
					).then(action => {
						if (action === 'Refresh Now') {
							codespaceExplorerProvider.refresh();
						}
					});
				} catch (error) {
					// Fallback: open extensions view with search
					await vscode.commands.executeCommand('workbench.view.extensions');
					await vscode.commands.executeCommand('workbench.extensions.search', 'anysphere.remote-containers');
					await vscode.window.showInformationMessage(
						'Please install the Anysphere Remote Containers extension from the marketplace. The explorer will auto-refresh when installation completes, or click "Refresh Now" to refresh immediately.',
						'Refresh Now'
					).then(action => {
						if (action === 'Refresh Now') {
							codespaceExplorerProvider.refresh();
						}
					});
				}
			} catch (error: any) {
				await vscode.window.showErrorMessage(
					`Failed to switch Remote Containers extension: ${error.message}`
				);
			}
		}
	);

	context.subscriptions.push(switchToAnysphereRemoteContainersCommand);

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

async function connectToCodespace(selectedCodespace?: Codespace): Promise<void> {
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

		// Step 2: Check for Remote Containers incompatibility
		const hasIncompatibility = remoteSshBridge.checkRemoteContainersIncompatibility();
		if (hasIncompatibility) {
			const action = await vscode.window.showErrorMessage(
				'The VSCode Remote Containers extension is not supported with the Anysphere Remote SSH extension. Please switch to the Anysphere Remote Containers extension.',
				'Switch to Anysphere Remote Containers'
			);
			if (action === 'Switch to Anysphere Remote Containers') {
				await vscode.commands.executeCommand('cursorCodespaces.switchToAnysphereRemoteContainers');
			}
			return;
		}

		// Step 3: Ensure Remote-SSH extension is ready
		const remoteSshReady = await remoteSshBridge.ensureReady();
		if (!remoteSshReady) {
			return;
		}

		// Step 4: Get codespace (either from parameter or picker)
		let codespace: Codespace | undefined = selectedCodespace;
		
		if (!codespace) {
			// Pick a codespace (always fetch fresh list)
			// Refresh codespace list to get latest status
			codespace = await codespacePicker.pickCodespace();
			if (!codespace) {
				return;
			}
		}

		// Step 5: Always refresh codespace status to get latest state
		// This is important especially when coming from the explorer (stale data)
		const allCodespaces = await ghService.listCodespaces();
		let latestCodespace = allCodespaces.find(cs => cs.name === codespace.name);
		
		if (!latestCodespace) {
			await vscode.window.showErrorMessage(
				`Codespace ${codespace.name} not found. It may have been deleted.`
			);
			return;
		}

		// Step 6: Ensure codespace is available (start if needed, wait if it's starting)
		if (latestCodespace.state !== 'Available') {
			const codespaceName = latestCodespace.name; // Store name to avoid TS issues
			await vscode.window.withProgress(
				{
					location: vscode.ProgressLocation.Notification,
					title: 'Waiting for codespace to be available...',
					cancellable: false
				},
				async (progress) => {
					await ghService.ensureCodespaceAvailable(codespaceName, progress);
				}
			);
			
			// After waiting, refresh the codespace status one more time
			const refreshedCodespaces = await ghService.listCodespaces();
			const refreshedCodespace = refreshedCodespaces.find(cs => cs.name === codespace.name);
			if (refreshedCodespace) {
				latestCodespace = refreshedCodespace;
			}
		}

		// Step 7: Generate SSH config
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

		// Step 8: Prepare repository-based host name
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

		// Step 9: Merge SSH config
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

		// Step 10: Connect via Remote-SSH using the same approach as the working extension
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
