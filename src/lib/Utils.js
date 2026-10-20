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
import Clutter from 'gi://Clutter';
import GObject from 'gi://GObject';
import * as Config from 'resource:///org/gnome/shell/misc/config.js';


const SHELL_MAJOR = Number(Config.PACKAGE_VERSION.split('.')[0]);

export const CHILD_ADDED = SHELL_MAJOR >= 46 ? 'child-added' : 'actor-added';
export const CHILD_REMOVED = SHELL_MAJOR >= 46 ? 'child-removed' : 'actor-removed';

export function createBox(vertical, styleClass, props = {}) {
    const orientation = SHELL_MAJOR >= 48
        ? {orientation: vertical ? Clutter.Orientation.VERTICAL : Clutter.Orientation.HORIZONTAL}
        : {vertical};
    return new St.BoxLayout({style_class: styleClass, ...orientation, ...props});
}

export function detachActor(actor) {
    const parent = actor.get_parent();
    const index = parent.get_children().indexOf(actor);
    parent.remove_child(actor);

    return () => {
        if (!isActorAlive(actor))
            return;

        const current = actor.get_parent();
        if (isActorAlive(current))
            current.remove_child(actor);
        if (isActorAlive(parent))
            parent.insert_child_at_index(actor, index);
    };
}

export function isActorAlive(actor) {
    if (!actor)
        return false;

    const state = GObject.Object.prototype.toString.call(actor).toUpperCase();
    return !state.includes('DISPOSED') && !state.includes('FINALIZED');
}