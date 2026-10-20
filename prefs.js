/*
* Sanket GNOME Extension
* Copyright (C) 2026 NarkAgni
*
* This program is free software: you can redistribute it and/or modify
* it under the terms of the GNU General Public License as published by
* the Free Software Foundation, either version 3 of the License, or
* any later version.
*
* This program is distributed in the hope that it will be useful,
* but WITHOUT ANY WARRANTY; without even the implied warranty of
* MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
* GNU General Public License for more details.
*
* You should have received a copy of the GNU General Public License
* along with this program. If not, see <https://www.gnu.org/licenses/>.
*/


import {ExtensionPreferences} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

import {buildAboutPage} from './src/prefs/AboutPage.js';
import {setupHeaderBar} from './src/prefs/HeaderBar.js';
import {buildIslandPage} from './src/prefs/IslandPage.js';
import {buildCalendarPage} from './src/prefs/CalendarPage.js';
import {buildAnimationsPage} from './src/prefs/AnimationsPage.js';
import {disconnectSettingSignals} from './src/prefs/SettingsSignals.js';


export default class SanketPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings();
        window._settings = settings;
        window.set_default_size(720, 860);

        buildIslandPage(window, settings);
        buildCalendarPage(window, settings);
        buildAnimationsPage(window, settings);
        buildAboutPage(this, window);
        setupHeaderBar(this, window);

        window.connect('close-request', () => {
            disconnectSettingSignals();
            return false;
        });
    }
}