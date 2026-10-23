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


import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';

import {ToggleOrder} from './src/ui/ToggleOrder.js';
import {SourceMerge} from './src/shell/SourceMerge.js';
import {MessageSlide} from './src/shell/MessageSlide.js';
import {setAnimationSpeed} from './src/ui/Animations.js';
import {CompactToggles} from './src/ui/CompactToggles.js';
import {DateMenuLayout} from './src/shell/DateMenuLayout.js';
import {NotificationIsland} from './src/ui/NotificationIsland.js';


export default class SanketExtension extends Extension {
    enable() {
        const {dateMenu, quickSettings} = Main.panel.statusArea;

        this._settings = this.getSettings();
        this._syncSpeed();
        this._settings.connectObject('changed::animation-speed', () => this._syncSpeed(), this);

        this._dateMenuLayout = new DateMenuLayout(dateMenu, quickSettings, this._settings);
        this._messageSlide = new MessageSlide(dateMenu._messageList);
        this._sourceMerge = new SourceMerge();
        this._toggleOrder = new ToggleOrder(quickSettings.menu, this._settings);
        this._compactToggles = new CompactToggles(quickSettings.menu, this._settings, this._toggleOrder);
        this._island = new NotificationIsland(quickSettings.menu, dateMenu, this._compactToggles,
            this._dateMenuLayout.calendarPanel, this._settings);
    }

    disable() {
        this._island.destroy();
        this._compactToggles.destroy();
        this._toggleOrder.destroy();
        this._sourceMerge.destroy();
        this._messageSlide.destroy();
        this._dateMenuLayout.destroy();

        this._settings.disconnectObject(this);
        setAnimationSpeed(1);

        this._island = null;
        this._compactToggles = null;
        this._toggleOrder = null;
        this._sourceMerge = null;
        this._messageSlide = null;
        this._dateMenuLayout = null;
        this._settings = null;
    }

    _syncSpeed() {
        setAnimationSpeed(this._settings.get_double('animation-speed'));
    }
}