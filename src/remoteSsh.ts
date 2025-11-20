import * as vscode from 'vscode';

export class RemoteSshBridge {
	private static instance: RemoteSshBridge;

	private constructor() {}

	public static getInstance(): RemoteSshBridge {
		if (!RemoteSshBridge.instance) {
			RemoteSshBridge.instance = new RemoteSshBridge();
		}
		return RemoteSshBridge.instance;
	}

	/**
	 * Ensure Remote-SSH extension is installed and ready
	 * Returns false if not available (UI is handled by the explorer)
	 */
	async ensureReady(): Promise<boolean> {
		return await this.checkRemoteSshAvailable();
	}

	/**
	 * Connect to a host via Remote-SSH extension
	 */
	async connectToHost(hostName: string, workspacePath?: string): Promise<void> {
		// Note: Remote-SSH availability should be checked via ensureReady() before calling this

		// First, reload SSH configs to ensure our new host is recognized
		try {
			await vscode.commands.executeCommand('remote-ssh.reload');
			// Wait for the reload to complete and host to be recognized
			await new Promise(resolve => setTimeout(resolve, 1000));
		} catch {
			// Ignore if reload command doesn't exist
		}

		// Try to refresh the Remote Explorer to ensure the host appears
		try {
			await vscode.commands.executeCommand('remoteExplorer.refresh');
			// Brief wait for refresh to complete
			await new Promise(resolve => setTimeout(resolve, 500));
		} catch {
			// Ignore if command doesn't exist
		}

		// Use the exact same approach as the working extension
		// Skip trying commands that don't exist in Cursor - go directly to vscode.openFolder
		// URI format: vscode-remote://ssh-remote+${repoName}/workspaces/${simpleRepoName}
		const uriPath = workspacePath ? `/workspaces/${workspacePath}` : '';
		const remoteUri = vscode.Uri.parse(`vscode-remote://ssh-remote+${hostName}${uriPath}`);
		
		// Open in the same window (user can use Remote-SSH explorer to open in new window if preferred)
		await vscode.commands.executeCommand('vscode.openFolder', remoteUri);
		
		// Connection should establish automatically
		return;
	}

	/**
	 * Check if Remote-SSH is available
	 * Checks for both Cursor's built-in Remote SSH and VS Code's Remote-SSH extension
	 */
	async checkRemoteSshAvailable(): Promise<boolean> {
		const extensions = vscode.extensions.all;
		
		// Check for Cursor's built-in Remote SSH (Anysphere Remote SSH)
		const cursorRemoteSsh = extensions.find(
			(ext: vscode.Extension<any>) => 
				ext.id === 'anysphere.remote-ssh'
		);
		
		// Check for the standard VS Code Remote-SSH extension
		const vscodeRemoteSsh = extensions.find(
			(ext: vscode.Extension<any>) => 
				ext.id === 'ms-vscode-remote.remote-ssh'
		);
		
		// If any Remote-SSH extension is found, it's available
		const remoteSshExt = cursorRemoteSsh || vscodeRemoteSsh;
		
		if (!remoteSshExt) {
			return false;
		}
		
		// Try to activate the extension if it's not already active
		if (!remoteSshExt.isActive) {
			try {
				await remoteSshExt.activate();
			} catch {
				// Extension might not be ready yet, but that's okay
				// Return true anyway since the extension exists
				return true;
			}
		}
		
		return true;
	}
}

