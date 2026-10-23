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


import Cogl from 'gi://Cogl';
import GObject from 'gi://GObject';
import Clutter from 'gi://Clutter';
import GdkPixbuf from 'gi://GdkPixbuf';


const DECLARATIONS = `
uniform sampler2D tex;
uniform float feather;
`;

const SOURCE = `
vec2 uv = cogl_tex_coord_in[0].xy;
float dist = length(uv - vec2(0.5)) - 0.5;
float alpha = 1.0 - smoothstep(-feather, 0.0, dist);
cogl_color_out = cogl_color_in * texture2D(tex, uv) * alpha;
`;

function aspectOf(gicon) {
    if (!gicon)
        return 1;
    if ('get_width' in gicon)
        return gicon.get_width() / Math.max(gicon.get_height(), 1);
    if (!('get_file' in gicon))
        return 1;

    const path = gicon.get_file().get_path();
    const [, width, height] = path ? GdkPixbuf.Pixbuf.get_file_info(path) : [null, 0, 0];
    return width > 0 && height > 0 ? width / height : 1;
}

export function coverRatio(gicon) {
    const aspect = aspectOf(gicon);
    return Math.max(aspect, 1 / aspect);
}

export const CoverLayout = GObject.registerClass(
class CoverLayout extends Clutter.LayoutManager {
    vfunc_get_preferred_width() {
        return [0, 0];
    }

    vfunc_get_preferred_height() {
        return [0, 0];
    }

    vfunc_allocate(container, box) {
        const child = container.get_first_child();
        if (!child)
            return;

        const [, width] = child.get_preferred_width(-1);
        const [, height] = child.get_preferred_height(width);
        const childBox = new Clutter.ActorBox();
        childBox.set_origin(Math.round((box.get_width() - width) / 2), Math.round((box.get_height() - height) / 2));
        childBox.set_size(width, height);
        child.allocate(childBox);
    }
});

export const ImageMask = GObject.registerClass(
class ImageMask extends Clutter.ShaderEffect {
    vfunc_get_static_snippet() {
        const snippet = Cogl.Snippet.new(Cogl.SnippetHook.FRAGMENT, DECLARATIONS, null);
        snippet.set_replace(SOURCE);
        return snippet;
    }

    vfunc_paint_target(node, paintContext) {
        this.set_uniform_float('feather', 1, [1 / Math.max(this.get_actor().width, 1)]);
        super.vfunc_paint_target(node, paintContext);
    }
});