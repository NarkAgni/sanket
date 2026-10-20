## [1.2] - 20-10-2026

### Notification island
* The island now takes its look from Quick Settings in your shell theme: same corners, background, border and padding, and it follows along if the theme or another extension changes Quick Settings
* The island is now exactly as wide as Quick Settings with every shell theme
* Works properly in both light and dark mode; no more fixed white highlights that disappear on light themes
* The **Clear** and **More Notifications** buttons and the pin button now use your theme's own button styles
* Shell themes that style notifications inside menus now style the island too

### Rearrange toggles
* New **edit** button next to the Settings button in Quick Settings: tap it, then drag any toggle to a new spot, both as a pill and as a circle in compact mode; the others slide out of the way and the order is remembered across restarts
* Toggles don't switch on or off while editing, so you can't flip one by accident; tap the checkmark or close Quick Settings to finish
* While editing, toggles get an outline in your theme's text color, so it shows up in light and dark mode alike
* Toggles added later by other extensions keep their place until you move them

### Compact Quick Settings
* Wi-Fi, Bluetooth, Power Mode and other toggles with a menu now turn into circles on GNOME 45, 46 and 47 too

### Calendar
* World clock page dots use your theme's text color and stay visible in light mode

## [1.1] - 20-10-2026

### Compact Quick Settings
* Toggles that appear or reappear while compact mode is on, like Bluetooth when an adapter connects or a new VPN toggle, now join the circles instead of showing up as full pills
* The Quick Settings height now updates correctly when toggles are added or removed in compact mode

### Calendar
* The animated weather card now uses much less CPU while the date menu is open
* Weather animation now stops and starts right away when system animations are turned off or on

### Under the hood
* Cleaner teardown of the compact toggle morph when the extension is disabled

## [1.0] - 20-10-2026

The first public release of Sanket.

### Notification island
* Notifications now live in their own floating card right below Quick Settings, separate from the date menu
* Only the newest notification is shown at first; a **“N More Notifications”** pill expands the rest and **Show Less** folds them back, with the arrow tilting smoothly between the two
* **Pin** any notification to keep it on top and protect it from being dismissed
* Long notifications expand and collapse in place with a smooth animation
* Dismissed notifications slide out sideways before the list closes the gap
* Pin, expand and close buttons appear only while the pointer is over a notification
* Clicking anywhere inside the island no longer closes Quick Settings; only clicking outside does
* Scrollbar can show while scrolling, always, or never

### Compact Quick Settings
* When notifications need room, the Wi-Fi, Bluetooth, Power Mode and other toggles morph from pills into circles, and back again when there is space
* The icon, title and the **>** menu part of each toggle travel with the morph, without jumps or blinking
* Volume and brightness sliders can each be kept or hidden separately in compact mode

### Calendar
* Two layouts: **Stacked** (everything in one column) and **Two Columns** (weather, world clocks and events on the left, calendar alone on the right)
* World clocks with **analog** faces or a **compact list**, split into pages with dots when you have many cities
* Animated weather card for clear sky, clear night, partly cloudy, cloudy, rain, snow, thunderstorm and fog
* Weather animation can be turned off for a still picture
* Months slide in from the side when you move between them
* Optional events list and date header
* **Add World Clocks…** and **Select Weather Location…** shortcuts when nothing is set yet

### Settings
* New settings window with live previews on every page: Island, Calendar, Animations and About
* A gallery that plays every weather animation side by side
* One speed control for every Sanket animation, from 0.25× to 3×
* Reset buttons for each group of options

### Compatibility
* GNOME Shell 45, 46, 47, 48, 49, 50 and 51