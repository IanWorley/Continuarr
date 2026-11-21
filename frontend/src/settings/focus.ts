/** A ref callback that focuses its element once. Pass it directly, so React sees the same function each render. */
export function focusOnMount(element: HTMLElement | null) {
  element?.focus()
}
