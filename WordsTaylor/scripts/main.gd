extends Control
## WordsTaylor - a 5-letter word guessing game. UI is built in code.

const WORD_LEN := 5
const MAX_TRIES := 6
const C_EMPTY := Color("#3a3a4c")
const C_CORRECT := Color("#3a9d5d")
const C_PRESENT := Color("#c9a227")
const C_ABSENT := Color("#1f1f2b")
const C_KEY := Color("#5b5b78")
const KEY_ROWS := ["QWERTYUIOP", "ASDFGHJKL", "+ZXCVBNM-"]  # + = ENTER, - = backspace

var valid := {}
var word_list: Array[String] = []
var answer := ""
var row := 0
var col := 0
var over := false
var cells: Array = []        # cells[r][c] = PanelContainer
var key_buttons := {}        # letter -> Button
var message: Label


func _ready() -> void:
	_load_words()
	_build_ui()
	_new_game()


func _load_words() -> void:
	var f := FileAccess.open("res://data/words.txt", FileAccess.READ)
	if f == null:
		push_error("Could not open words.txt")
		return
	while not f.eof_reached():
		var w := f.get_line().strip_edges().to_upper()
		if w.length() == WORD_LEN:
			word_list.append(w)
			valid[w] = true


func _style(c: Color) -> StyleBoxFlat:
	var s := StyleBoxFlat.new()
	s.bg_color = c
	s.set_corner_radius_all(10)
	return s


func _build_ui() -> void:
	var bg := ColorRect.new()
	bg.color = Color("#14141c")
	bg.set_anchors_preset(Control.PRESET_FULL_RECT)
	add_child(bg)

	var margin := MarginContainer.new()
	margin.set_anchors_preset(Control.PRESET_FULL_RECT)
	for side in ["left", "right", "top", "bottom"]:
		margin.add_theme_constant_override("margin_" + side, 24)
	# Extra top/bottom room for the iPhone notch and home indicator.
	margin.add_theme_constant_override("margin_top", 70)
	margin.add_theme_constant_override("margin_bottom", 50)
	add_child(margin)

	var vbox := VBoxContainer.new()
	vbox.add_theme_constant_override("separation", 18)
	margin.add_child(vbox)

	var title := Label.new()
	title.text = "WordsTaylor"
	title.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	title.add_theme_font_size_override("font_size", 52)
	vbox.add_child(title)

	message = Label.new()
	message.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	message.add_theme_font_size_override("font_size", 28)
	message.custom_minimum_size = Vector2(0, 40)
	vbox.add_child(message)

	var center := CenterContainer.new()
	vbox.add_child(center)
	var grid := GridContainer.new()
	grid.columns = WORD_LEN
	grid.add_theme_constant_override("h_separation", 10)
	grid.add_theme_constant_override("v_separation", 10)
	center.add_child(grid)
	for r in MAX_TRIES:
		var line: Array = []
		for c in WORD_LEN:
			var cell := PanelContainer.new()
			cell.custom_minimum_size = Vector2(110, 110)
			cell.add_theme_stylebox_override("panel", _style(C_EMPTY))
			var lbl := Label.new()
			lbl.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
			lbl.vertical_alignment = VERTICAL_ALIGNMENT_CENTER
			lbl.add_theme_font_size_override("font_size", 56)
			cell.add_child(lbl)
			grid.add_child(cell)
			line.append(cell)
		cells.append(line)

	var spacer := Control.new()
	spacer.size_flags_vertical = Control.SIZE_EXPAND_FILL
	vbox.add_child(spacer)

	for letters: String in KEY_ROWS:
		var hb := HBoxContainer.new()
		hb.alignment = BoxContainer.ALIGNMENT_CENTER
		hb.add_theme_constant_override("separation", 6)
		vbox.add_child(hb)
		for ch in letters:
			var b := Button.new()
			var key: String = ch
			var is_enter := key == "+"
			var is_back := key == "-"
			b.text = "ENTER" if is_enter else ("⌫" if is_back else key)
			b.custom_minimum_size = Vector2(88 if (is_enter or is_back) else 62, 96)
			b.focus_mode = Control.FOCUS_NONE
			b.add_theme_font_size_override("font_size", 24)
			_set_key_color(b, C_KEY)
			b.pressed.connect(_press.bind("ENTER" if is_enter else ("BACK" if is_back else key)))
			hb.add_child(b)
			if not is_enter and not is_back:
				key_buttons[key] = b

	var again := Button.new()
	again.text = "New game"
	again.custom_minimum_size = Vector2(0, 80)
	again.add_theme_font_size_override("font_size", 28)
	again.focus_mode = Control.FOCUS_NONE
	again.pressed.connect(_new_game)
	vbox.add_child(again)


func _set_key_color(b: Button, c: Color) -> void:
	for state in ["normal", "hover", "pressed"]:
		b.add_theme_stylebox_override(state, _style(c))


func _new_game() -> void:
	answer = word_list.pick_random() if not word_list.is_empty() else "HELLO"
	row = 0
	col = 0
	over = false
	message.text = "Guess the word"
	for line: Array in cells:
		for cell: PanelContainer in line:
			cell.add_theme_stylebox_override("panel", _style(C_EMPTY))
			(cell.get_child(0) as Label).text = ""
	for k: String in key_buttons:
		_set_key_color(key_buttons[k], C_KEY)


func _unhandled_key_input(event: InputEvent) -> void:
	var e := event as InputEventKey
	if e == null or not e.pressed or e.echo:
		return
	if e.keycode == KEY_ENTER or e.keycode == KEY_KP_ENTER:
		_press("ENTER")
	elif e.keycode == KEY_BACKSPACE:
		_press("BACK")
	elif e.keycode >= KEY_A and e.keycode <= KEY_Z:
		_press(char(e.keycode))


func _press(k: String) -> void:
	if over:
		return
	if k == "ENTER":
		_submit()
	elif k == "BACK":
		if col > 0:
			col -= 1
			(cells[row][col].get_child(0) as Label).text = ""
	elif col < WORD_LEN:
		(cells[row][col].get_child(0) as Label).text = k
		col += 1


func _current_guess() -> String:
	var s := ""
	for c in WORD_LEN:
		s += (cells[row][c].get_child(0) as Label).text
	return s


func _submit() -> void:
	if col < WORD_LEN:
		message.text = "Not enough letters"
		return
	var guess := _current_guess()
	if not valid.has(guess):
		message.text = "Not in word list"
		return
	message.text = ""

	# Two-pass scoring: greens first, then yellows limited by remaining letter counts.
	var result: Array[Color] = []
	result.resize(WORD_LEN)
	var remaining := {}
	for i in WORD_LEN:
		if guess[i] == answer[i]:
			result[i] = C_CORRECT
		else:
			result[i] = C_ABSENT
			remaining[answer[i]] = remaining.get(answer[i], 0) + 1
	for i in WORD_LEN:
		if result[i] == C_ABSENT and remaining.get(guess[i], 0) > 0:
			result[i] = C_PRESENT
			remaining[guess[i]] -= 1

	for i in WORD_LEN:
		cells[row][i].add_theme_stylebox_override("panel", _style(result[i]))
		_update_key(guess[i], result[i])

	if guess == answer:
		message.text = "You got it!"
		over = true
	elif row == MAX_TRIES - 1:
		message.text = "The word was " + answer
		over = true
	else:
		row += 1
		col = 0


func _update_key(letter: String, c: Color) -> void:
	var b: Button = key_buttons.get(letter)
	if b == null:
		return
	var current: Color = b.get_theme_stylebox("normal").bg_color
	var rank := {C_KEY: 0, C_ABSENT: 1, C_PRESENT: 2, C_CORRECT: 3}
	if rank[c] > rank.get(current, 0):
		_set_key_color(b, c)
