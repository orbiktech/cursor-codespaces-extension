import * as vscode from 'vscode';
import { Codespace, GhService } from './ghService';

export class CodespacePicker {
	private static instance: CodespacePicker;

	private constructor() {}

	public static getInstance(): CodespacePicker {
		if (!CodespacePicker.instance) {
			CodespacePicker.instance = new CodespacePicker();
		}
		return CodespacePicker.instance;
	}

	/**
	 * Show QuickPick to select a codespace
	 * Always fetches fresh codespace list to show latest status
	 */
	async pickCodespace(): Promise<Codespace | undefined> {
		const ghService = GhService.getInstance();
		
		try {
			// Always fetch fresh codespace list to get latest status
			const codespaces = await ghService.listCodespaces();
			
			if (codespaces.length === 0) {
				await vscode.window.showInformationMessage(
					'No codespaces found. Create one at https://github.com/codespaces'
				);
				return undefined;
			}

			// Create QuickPick items
			const items = codespaces.map(codespace => {
				const stateIcon = codespace.state === 'Available' ? '✓' : '⏸';
				// Use repository as the main label (highlighted info)
				const label = `${stateIcon} ${codespace.repository}`;
				const description = `${codespace.displayName || codespace.name} • ${codespace.state}`;
				const detail = codespace.lastUsedAt 
					? `Last used: ${new Date(codespace.lastUsedAt).toLocaleString()}`
					: 'Never used';

				return {
					label,
					description,
					detail,
					codespace
				};
			});

			const selected = await vscode.window.showQuickPick(items, {
				placeHolder: 'Select a codespace to connect to',
				ignoreFocusOut: true
			});

			return selected?.codespace;
		} catch (error: any) {
			await vscode.window.showErrorMessage(
				`Failed to list codespaces: ${error.message}`
			);
			return undefined;
		}
	}
}

