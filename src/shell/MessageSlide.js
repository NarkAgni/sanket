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


import Clutter from 'gi://Clutter';
import {InjectionManager} from 'resource:///org/gnome/shell/extensions/extension.js';

import {easeTo} from '../ui/Animations.js';
import {CHILD_ADDED, isActorAlive} from '../lib/Utils.js';


const SLIDE_DURATION = 240;
const SLIDE_MODE = Clutter.AnimationMode.EASE_OUT_CUBIC;

function slideOffset(item) {
    const direction = item.get_text_direction() === Clutter.TextDirection.RTL ? -1 : 1;
    return Math.round(item.width * 0.65) * direction;
}

function parentOf(_owner, message) {
    return message.get_parent();
}

function groupItemOf(group, notification) {
    return group._notificationToMessage.get(notification).get_parent();
}

function stackBelow(group) {
    const [, , ...rest] = group.get_children();
    return rest.slice(0, -1);
}

function resetCard(card) {
    card.remove_transition('translation-y');
    card.remove_transition('scale-x');
    card.translation_y = 0;
    card.scale_x = 1;
}

export class MessageSlide {
    constructor(messageList) {
        this._injections = new InjectionManager();
        this._leaving = new WeakSet();
        this._patched = new WeakSet();
        this._view = messageList._messageView;

        if (this._view) {
            this._patch(this._view, '_removeMessage', parentOf, () => true);
            this._view.connectObject(CHILD_ADDED, (_view, item) => this._watchGroup(item.child), this);
            this._view.get_children().forEach(item => this._watchGroup(item.child));
        } else {
            [messageList._mediaSection, messageList._notificationSection].forEach(section =>
                this._patch(section, 'removeMessage', parentOf, () => true));
        }
    }

    destroy() {
        if (this._view)
            this._view.disconnectObject(this);
        this._injections.clear();

        this._injections = null;
        this._leaving = null;
        this._patched = null;
        this._view = null;
    }

    _watchGroup(message) {
        if (!message || !message._removeNotification)
            return;

        const prototype = Object.getPrototypeOf(message);
        if (this._patched.has(prototype))
            return;

        this._patched.add(prototype);
        this._patch(prototype, '_removeNotification', groupItemOf, (group, item) => this._prepareGroup(group, item));
    }

    _prepareGroup(group, item) {
        if (group.expanded)
            return true;
        if (group.get_first_child() !== item)
            return false;

        const stack = stackBelow(group);
        let target = item.allocation;
        stack.forEach((card, index) => {
            const box = card.allocation;
            const y = index === 0 ? target.y1 : target.y2 - box.get_height();
            card.set_pivot_point(0.5, 0);
            easeTo(card, {
                translation_y: y - box.y1,
                scale_x: target.get_width() / Math.max(box.get_width(), 1),
            }, null, SLIDE_DURATION, SLIDE_MODE);
            target = box;
        });

        item.connectObject('destroy', () => stack.filter(isActorAlive).forEach(resetCard), this);
        return true;
    }

    _patch(target, method, findItem, prepare) {
        const leaving = this._leaving;

        this._injections.overrideMethod(target, method, original => function (subject, animate = true) {
            const item = findItem(this, subject);
            if (leaving.has(item))
                return;

            if (!animate || item.translation_x !== 0 || !prepare(this, item)) {
                original.call(this, subject, animate);
                return;
            }

            leaving.add(item);
            easeTo(
                item,
                {translation_x: slideOffset(item), opacity: 0},
                () => original.call(this, subject, animate),
                SLIDE_DURATION,
                SLIDE_MODE);
        });
    }
}