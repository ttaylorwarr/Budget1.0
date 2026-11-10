# WordsTaylor

A 5-letter word guessing game for iPhone, built with Godot 4.3+.

## Open in Godot
1. Godot Project Manager -> Import -> select `WordsTaylor/project.godot`.
2. Press F5 to play on desktop (keyboard or mouse works).

## Export to iOS (needs a Mac with Xcode)
1. Godot -> Editor -> Manage Export Templates -> download templates.
2. Project -> Export -> iOS: set your Apple **Team ID** and a unique **Bundle Identifier**
   (replace `com.example.wordstaylor`).
3. Export; open the generated `.xcodeproj` in Xcode; pick your iPhone; Run.

## Files
- `scripts/main.gd` - all game logic and UI (built in code)
- `data/words.txt` - word list (add more 5-letter words freely)
