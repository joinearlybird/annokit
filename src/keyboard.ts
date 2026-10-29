/**
 * How tall the keyboard is, right now.
 *
 * A sheet that wants to say what it COVERS has to add the keyboard to its
 * own height: with a text input focused, the KeyboardAvoidingView lifts the
 * sheet and the strip of screen the user cannot see is sheet + keyboard.
 * Reporting only the sheet told the aim label — and would tell the push
 * geometry — that a third of the screen was free when it was under the
 * keyboard.
 *
 * `willShow` on iOS so the report lands with the sheet's own lift rather
 * than a beat after it; `didShow` elsewhere, because that is the only one
 * Android sends. Fails soft to 0, so a platform with no keyboard events
 * simply reports the sheet, as before.
 *
 * Shared by the composer and the detail panes — one keyboard, one rule.
 */

import { useEffect, useState } from "react";
import { Keyboard, Platform } from "react-native";

export function useKeyboardHeight(): number {
  const [height, setHeight] = useState(0);
  useEffect(() => {
    const showEvent = Platform.OS === "ios" ? "keyboardWillShow" : "keyboardDidShow";
    const hideEvent = Platform.OS === "ios" ? "keyboardWillHide" : "keyboardDidHide";
    const show = Keyboard.addListener(showEvent, (e) =>
      setHeight(e?.endCoordinates?.height ?? 0),
    );
    const hide = Keyboard.addListener(hideEvent, () => setHeight(0));
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);
  return height;
}
