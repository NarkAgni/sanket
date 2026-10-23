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


import St from 'gi://St';
import GLib from 'gi://GLib';
import * as Signals from 'resource:///org/gnome/shell/misc/signals.js';
import {gettext as _} from 'resource:///org/gnome/shell/extensions/extension.js';

import {TimeoutTracker} from '../lib/TimeoutTracker.js';
import {ReorderDrag, slideReorder} from './ReorderDrag.js';
import {CHILD_ADDED, CHILD_REMOVED, tintOf} from '../lib/Utils.js';
import {arrange, gridToggles, isToggle, mergeOrder, moveOnto, placeToggles, toggleKeys} from '../lib/Toggles.js';


const EDITING_CLASS = 'sanket-editing';
const CUE_ALPHA = 0.35;

function hasClass(actor, styleClass) {
    return Boolean(actor.has_style_class_name) && actor.has_style_class_name(styleClass);
}

export class ToggleOrder extends Signals.EventEmitter {
    constructor(menu, settings) {
        super();
        this._menu = menu;
        this._grid = menu._grid;
        this._settings = settings;
        this._natural = gridToggles(this._grid);
        this._timers = new TimeoutTracker();
        this._applyId = 0;
        this._editing = false;

        this._drag = new ReorderDrag(
            () => gridToggles(this._grid).filter(toggle => toggle.visible),
            (dragged, target) => this._moveInGrid(dragged, target),
            () => this._save());
        this._natural.forEach(toggle => this._drag.watch(toggle));

        this._grid.connectObject(
            CHILD_ADDED, (_grid, child) => this._onAdded(child),
            CHILD_REMOVED, (_grid, child) => this._onRemoved(child),
            this);
        this._menu.connectObject('open-state-changed', (_menu, open) => {
            if (!open)
                this._setEditing(false);
        }, this);
        this._settings.connectObject('changed::toggle-order', () => {
            if (this._apply())
                this.emit('changed');
        }, this);

        this._addEditButton();
        this._apply();
    }

    get editing() {
        return this._editing;
    }

    commit(items) {
        placeToggles(this._grid, arrange(gridToggles(this._grid), items));
        this._save();
    }

    destroy() {
        this._setEditing(false);
        this._timers.destroy();
        this._drag.destroy();
        this._editButton.destroy();
        this._grid.disconnectObject(this);
        this._menu.disconnectObject(this);
        this._settings.disconnectObject(this);
        placeToggles(this._grid, arrange(gridToggles(this._grid), this._natural));

        this._timers = null;
        this._editButton = null;
        this._drag = null;
        this._natural = null;
        this._settings = null;
        this._grid = null;
        this._menu = null;
    }

    _addEditButton() {
        const row = this._grid.get_children().find(child => hasClass(child, 'quick-settings-system-item')).child;
        this._editButton = new St.Button({
            style_class: 'icon-button sanket-edit-button',
            can_focus: true,
            accessible_name: _('Rearrange Toggles'),
            child: new St.Icon({icon_name: 'document-edit-symbolic'}),
        });
        this._editButton.connectObject('clicked', () => this._setEditing(!this._editing), this);

        row.insert_child_below(this._editButton, row.get_children().find(child => hasClass(child, 'icon-button')));
    }

    _setEditing(editing) {
        if (this._editing === editing)
            return;

        this._editing = editing;
        const cue = editing ? `box-shadow: inset 0 0 0 2px ${tintOf(this._menu.box, CUE_ALPHA)};` : '';
        this._drag.setEnabled(editing, cue);
        this._editButton.checked = editing;
        this._editButton.child.icon_name = editing ? 'object-select-symbolic' : 'document-edit-symbolic';
        this._editButton.accessible_name = editing ? _('Done') : _('Rearrange Toggles');
        if (editing)
            this._menu.box.add_style_class_name(EDITING_CLASS);
        else
            this._menu.box.remove_style_class_name(EDITING_CLASS);
        this.emit('editing-changed', editing, cue);
    }

    _apply() {
        const saved = this._settings.get_strv('toggle-order');
        const toggles = gridToggles(this._grid);
        const keys = toggleKeys(this._natural);
        const ordered = saved.length > 0
            ? arrange(toggles, saved, toggle => keys.get(toggle))
            : arrange(toggles, this._natural);
        return placeToggles(this._grid, ordered);
    }

    _queueApply() {
        if (this._applyId)
            return;

        this._applyId = this._timers.addIdle(GLib.PRIORITY_DEFAULT_IDLE, () => {
            this._applyId = 0;
            this._apply();
            return GLib.SOURCE_REMOVE;
        });
    }

    _onAdded(child) {
        if (!isToggle(child))
            return;

        const toggles = gridToggles(this._grid);
        const previous = toggles[toggles.indexOf(child) - 1];
        this._natural.splice(previous ? this._natural.indexOf(previous) + 1 : 0, 0, child);
        this._drag.watch(child);
        this._queueApply();
    }

    _onRemoved(child) {
        const index = this._natural.indexOf(child);
        if (index < 0)
            return;

        this._natural.splice(index, 1);
        this._drag.unwatch(child);
    }

    _moveInGrid(dragged, target) {
        const order = moveOnto(gridToggles(this._grid), dragged, target);
        slideReorder(this._grid, () => placeToggles(this._grid, order), dragged);
    }

    _save() {
        const keys = toggleKeys(this._natural);
        const current = gridToggles(this._grid).map(toggle => keys.get(toggle));
        this._settings.set_strv('toggle-order', mergeOrder(this._settings.get_strv('toggle-order'), current));
    }
}