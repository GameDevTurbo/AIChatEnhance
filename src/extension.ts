import * as vscode from 'vscode';
import { PlannerPanel } from './PlannerPanel';

export function activate(context: vscode.ExtensionContext): void {
    // Sidebar welcome view — shows a link to open the main panel
    context.subscriptions.push(
        vscode.window.registerTreeDataProvider('taskPlannerView', {
            getTreeItem: (el: string) => new vscode.TreeItem(el),
            getChildren: () => [] as string[],
        })
    );

    // Command to open editor panel
    context.subscriptions.push(
        vscode.commands.registerCommand('task-planner.openPlanner', () => {
            PlannerPanel.createOrShow(context);
        })
    );
}

export function deactivate(): void { /* nothing */ }
