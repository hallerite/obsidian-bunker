import { App, Notice, Plugin, PluginSettingTab, Setting, TFolder, setIcon, FileSystemAdapter } from 'obsidian';
import { exec } from 'child_process';

interface BunkerPluginSettings {
    mountDirectory: string;
    containerFile: string;
}

const DEFAULT_SETTINGS: BunkerPluginSettings = {
    mountDirectory: '', // Must be selected by the user
    containerFile: 'container.vc' // Default relative path
};

export default class BunkerPlugin extends Plugin {
    settings: BunkerPluginSettings;
    isMounted: boolean = false;
    ribbonIconEl: HTMLElement | null = null;

    async onload() {
        console.log("Bunker Plugin Loaded");
        await this.loadSettings();
        await this.updateMountStatus(); // Ensure correct mount state on startup

        // Add a ribbon icon for quick toggling
        this.ribbonIconEl = this.addRibbonIcon(
            this.isMounted ? 'unlock' : 'lock',
            'Toggle VeraCrypt Mount',
            async () => {
                console.log("Ribbon icon clicked");
                await this.toggleMount();
            }
        );

        // Add settings tab for user configuration
        this.addSettingTab(new BunkerSettingTab(this.app, this));
    }

    async updateMountStatus(): Promise<void> {
        console.log("Updating mount status...");
        this.isMounted = await this.checkMountStatus();
        console.log("Mount status updated:", this.isMounted);
        this.updateLockIcon();
    }

    async checkMountStatus(): Promise<boolean> {
        console.log("Checking mount status...");
        return new Promise((resolve) => {
            exec('veracrypt --text --list', (error, stdout, stderr) => {
                if (error && stderr.includes("No volumes mounted")) {
                    console.log("No volumes are currently mounted.");
                    resolve(false);
                    return;
                }

                if (error) {
                    console.error('Error checking mount status:', error);
                    new Notice(`Error checking mount status: ${stderr || error.message}`);
                    resolve(false);
                    return;
                }

                const isMounted = stdout.includes(this.getFullMountPath());
                console.log("Mount status check result:", isMounted);
                resolve(isMounted);
            });
        });
    }

    async toggleMount(): Promise<void> {
        console.log("Toggling mount state...");
        this.isMounted = await this.checkMountStatus();
        console.log("Current mount state:", this.isMounted);

        if (this.isMounted) {
            console.log("Calling unmountVolume()");
            this.unmountVolume();
        } else {
            console.log("Calling mountVolume()");
            this.mountVolume();
        }
    }

    mountVolume(): void {
		let { containerFile, mountDirectory } = this.settings;
		if (!mountDirectory) {
			console.warn("No mount directory selected.");
			new Notice("Error: No mount directory selected.");
			return;
		}
	
		const vaultPath = this.getVaultPath();
		const fullMountPath = `${vaultPath}/${mountDirectory}`;
	
		if (!containerFile.startsWith('/')) {
			containerFile = `${vaultPath}/${containerFile}`;
		}
	
		const command = `veracrypt --mount "${containerFile}" "${fullMountPath}"`;
		console.log("Executing mount command:", command);
	
		exec(command, (error, stdout, stderr) => {
			if (error) {
				console.error('Mount error:', stderr);
				new Notice(`Mount failed: ${stderr || error.message}`);
			} else {
				console.log("Mount successful:", stdout);
				new Notice(`Mounted ${containerFile} at ${fullMountPath}`);
				this.isMounted = true;
				this.updateLockIcon();
	
				(this.app as any).commands.executeCommandById('app:reload');
			}
		});
	}	

    unmountVolume(): void {
        const fullMountPath = this.getFullMountPath();
        console.log("Unmounting:", fullMountPath);

        exec('veracrypt --text --list', (error, stdout, stderr) => {
            if (error || !stdout.includes(fullMountPath)) {
                console.warn("Unmount attempt failed: Volume is not currently mounted.");
                new Notice("Error: Volume is not currently mounted.");
                return;
            }

            const command = `veracrypt --dismount "${fullMountPath}"`;
            console.log("Executing unmount command:", command);

            exec(command, (error, stdout, stderr) => {
                if (error) {
                    console.error('Unmount error:', stderr);
                    new Notice(`Unmount failed: ${stderr || error.message}`);
                } else {
                    console.log("Unmount successful:", stdout);
                    new Notice(`Unmounted ${fullMountPath}`);
                    this.isMounted = false;
                    this.updateLockIcon();

					(this.app as any).commands.executeCommandById('app:reload');
                }
            });
        });
    }

    getVaultPath(): string {
        return this.app.vault.adapter instanceof FileSystemAdapter
            ? (this.app.vault.adapter as FileSystemAdapter).getBasePath()
            : "";
    }

    getFullMountPath(): string {
        return `${this.getVaultPath()}/${this.settings.mountDirectory}`;
    }

    updateLockIcon(): void {
        if (this.ribbonIconEl) {
            const icon = this.isMounted ? 'unlock' : 'lock';
            console.log("Updating UI icon:", icon);
            this.ribbonIconEl.setAttribute('aria-label', this.isMounted ? 'Unlock (Click to Unmount)' : 'Lock (Click to Mount)');
            this.ribbonIconEl.innerHTML = ''; // Clear previous icon
            setIcon(this.ribbonIconEl, icon);
        }
    }

    async loadSettings() {
        this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    }

    async saveSettings() {
        await this.saveData(this.settings);
    }
}

/**
 * Plugin settings UI.
 */
class BunkerSettingTab extends PluginSettingTab {
    plugin: BunkerPlugin;

    constructor(app: App, plugin: BunkerPlugin) {
        super(app, plugin);
        this.plugin = plugin;
    }

    display(): void {
        const { containerEl } = this;
        containerEl.empty();

        containerEl.createEl('h2', { text: 'Bunker Plugin Settings' });

        // Container File Path Setting
        new Setting(containerEl)
            .setName('Container File')
            .setDesc('Path to the VeraCrypt container file (relative to vault or absolute)')
            .addText(text =>
                text
                    .setPlaceholder('container.vc')
                    .setValue(this.plugin.settings.containerFile)
                    .onChange(async (value) => {
                        this.plugin.settings.containerFile = value;
                        await this.plugin.saveSettings();
                    })
            );

        // Folder Picker for Mount Directory
        new Setting(containerEl)
            .setName('Mount Directory')
            .setDesc('Choose an existing folder in Obsidian to mount the VeraCrypt volume')
            .addDropdown(dropdown => {
                const folders = this.getFolders();
                if (folders.length === 0) {
                    new Notice("No folders found in the vault.");
                    return;
                }

                folders.forEach(folder => dropdown.addOption(folder, folder));

                dropdown.setValue(this.plugin.settings.mountDirectory || folders[0]); // Default to first folder

                dropdown.onChange(async (value) => {
                    this.plugin.settings.mountDirectory = value;
                    await this.plugin.saveSettings();
                });
            });
    }

    getFolders(): string[] {
        return this.app.vault.getAllLoadedFiles()
            .filter(file => file instanceof TFolder)
            .map(folder => folder.path);
    }
}
