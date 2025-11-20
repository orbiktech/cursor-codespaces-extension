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
	 * Connect to a host via Remote-SSH extension
	 */
	async connectToHost(hostName: string, workspacePath?: string): Promise<void> {
		// Ensure Remote-SSH is available
		// In Cursor, Remote-SSH is built-in, so this should always pass
		const isAvailable = await this.checkRemoteSshAvailable();
		if (!isAvailable) {
			throw new Error(
				'Remote-SSH is not available. ' +
				'In Cursor, Remote-SSH is built-in. ' +
				'In VS Code, please install the Remote-SSH extension from the marketplace.'
			);
		}

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
	 * In Cursor, Remote-SSH is built-in (Anysphere Remote SSH)
	 * In VS Code, it's an extension
	 */
	async checkRemoteSshAvailable(): Promise<boolean> {
		// Check if we're in Cursor (has built-in Remote SSH) or VS Code (needs extension)
		const extensions = vscode.extensions.all;
		
		// Check for Cursor's built-in Remote SSH (Anysphere Remote SSH)
		const cursorRemoteSsh = extensions.find(
			(ext: vscode.Extension<any>) => 
				ext.id.includes('anysphere') && ext.id.includes('remote')
		);
		
		// Check for VS Code Remote-SSH extension (for VS Code compatibility)
		const vscodeRemoteSsh = extensions.find(
			(ext: vscode.Extension<any>) => 
				ext.id === 'ms-vscode-remote.remote-ssh' ||
				(ext.id.includes('remote-ssh') && !ext.id.includes('anysphere'))
		);
		
		// If either is available, Remote-SSH is available
		const remoteSshExt = cursorRemoteSsh || vscodeRemoteSsh;
		
		if (!remoteSshExt) {
			return false;
		}
		
		// Try to activate the extension if it's not already active
		if (!remoteSshExt.isActive) {
			try {
				await remoteSshExt.activate();
			} catch {
				// Extension might not be ready yet, but that's okay - built-in features might not need activation
				// Return true anyway since the feature exists
				return true;
			}
		}
		
		return true;
	}
}

