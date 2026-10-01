# CFRU Spread Editor

A tool for editing CFRU Battle Frontier, special trainer, multi partner, and raid partner spreads in your browser.

## Features

- Find spreads by Pokémon, trainer, battle type, and more.
- Edit moves, items, abilities, natures, IVs, EVs, and battle settings.
- Add, delete, and reorder spreads.
- Preview stats and automatically fix common move, IV, and EV issues.
- Import and export Pokémon Showdown sets.
- Download the editor's required and available optional files as a ZIP, or upload that ZIP to edit a cached copy.
- Save changes with automatic backups, or revert unwanted edits.

## Run Locally

### First-Time Setup

1. Install [Git](https://git-scm.com/downloads) and the current **LTS** version of [Node.js](https://nodejs.org/en/download).
2. Download or clone this editor and the following repositories onto your computer:
	- [Complete Fire Red Upgrade](https://github.com/Skeli789/Complete-Fire-Red-Upgrade)
	- [Dynamic Pokemon Expansion](https://github.com/Skeli789/Dynamic-Pokemon-Expansion)
	- [Unbound Cloud](https://github.com/Skeli789/Unbound-Cloud)

	To download a repository without Git, open its GitHub page, click **Code → Download ZIP**, and extract the ZIP.

Already have these repositories? Use your existing folders. They do not need to be beside the editor.

### Build the App

Open the editor folder and run the build script:

- **Windows:** double-click [build.bat](build.bat).
- **macOS/Linux:** open a terminal in the editor folder and run `bash build.sh`.

Wait until you see **Build completed successfully!** You only need to do this the first time and after updating the editor. The script installs the other tools it needs, so an internet connection is required.

### Start the App

1. Run the start script from the editor folder:
	- **Windows:** double-click [start.bat](start.bat).
	- **macOS/Linux:** open a terminal in the editor folder and run `bash start.sh`.
2. Leave the Client and Server terminal windows open while using the editor.
3. Open http://localhost:3000 in your browser. If a launcher keeps saying it is waiting, try opening this address yourself.

To stop the app, close the Client and Server terminal windows.

**macOS/Linux:** use an editor folder whose full path contains no spaces. If the launcher cannot open terminal windows, see [manual startup](TECHNICAL.md#manual-installation-and-startup).

### Connect Your Repositories

1. In **Connect Repositories**, select the folders for CFRU, DPE, and Unbound Cloud. Choose each repository's main folder, not a folder inside it.
	- **Windows:** use **Browse** to choose each folder.
	- **macOS/Linux:** enter each folder's full path.
2. Choose the game that matches your project.
3. Review **Load Warnings** if any appear, then start editing.

The editor remembers your folders and game for the next launch.

### Use a Portable ZIP

On **Connect Repositories**, choose **Upload ZIP** instead of entering repository folders. The included game opens automatically when specified; otherwise choose a game.

**Save Changes** writes to the cached copy, not the original ZIP or checkout. Download the ZIP again to transfer saved changes.

## Using the Editor

- Use the filters to find the spreads you want to change.
- Edit an existing spread, or use **Add Spread** to create one.
- To import Showdown sets, choose **Add Spread → Import Showdown Text** and paste your sets.
- Click **Save Changes** when you are ready to write your edits to CFRU. Until then, your source files are unchanged.
- Use the revert actions to discard unwanted edits.

The editor only changes supported CFRU spread files. DPE and Unbound Cloud are never modified. Showdown exports are useful for sharing sets, but are not a complete backup of your source files.

## Need Help?

- **The page does not open:** make sure the Client and Server windows are still running, then try http://localhost:3000 again.
- **A repository will not connect:** select its main folder and make sure the download is fully extracted.
- **The app reports outside changes when saving:** your source files changed since they were loaded. Review those changes before reloading; do not discard unsaved work you still need.
- **You updated the editor:** run the build script again, then restart the app.

For manual setup, development, tests, repository file requirements, and explanations of how saving and backups work, see the [Technical Reference](TECHNICAL.md).

This app is intended for use on your own computer, not as a public website.
