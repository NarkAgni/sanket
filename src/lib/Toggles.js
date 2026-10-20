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


const TOGGLE_CLASSES = ['quick-toggle', 'quick-toggle-has-menu', 'quick-menu-toggle'];

export function isToggle(actor) {
    return Boolean(actor.has_style_class_name) &&
        TOGGLE_CLASSES.some(styleClass => actor.has_style_class_name(styleClass));
}

export function gridToggles(grid) {
    return grid.get_children().filter(isToggle);
}

export function toggleKeys(toggles) {
    const counts = new Map();
    return new Map(toggles.map(toggle => {
        const name = toggle.constructor.name;
        const count = counts.get(name) || 0;
        counts.set(name, count + 1);
        return [toggle, `${name}:${count}`];
    }));
}

export function arrange(items, order, keyOf = item => item) {
    const rank = new Map(order.map((key, index) => [key, index]));
    const ranked = item => rank.has(keyOf(item));
    const known = items.filter(ranked).sort((first, second) => rank.get(keyOf(first)) - rank.get(keyOf(second)));
    let next = 0;
    return items.map(item => ranked(item) ? known[next++] : item);
}

export function moveOnto(items, dragged, target) {
    const order = items.filter(item => item !== dragged);
    const index = order.indexOf(target);
    order.splice(items.indexOf(dragged) < items.indexOf(target) ? index + 1 : index, 0, dragged);
    return order;
}

export function mergeOrder(saved, current) {
    const merged = [...current];
    saved.forEach((key, index) => {
        if (merged.includes(key))
            return;

        const previous = saved.slice(0, index).reverse().find(other => merged.includes(other));
        merged.splice(previous ? merged.indexOf(previous) + 1 : 0, 0, key);
    });
    return merged;
}

export function placeToggles(grid, ordered) {
    let next = 0;
    let moved = false;
    grid.get_children()
        .map(child => isToggle(child) ? ordered[next++] : child)
        .forEach((child, index) => {
            if (grid.get_child_at_index(index) === child)
                return;

            grid.set_child_at_index(child, index);
            moved = true;
        });
    return moved;
}