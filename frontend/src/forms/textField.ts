/** The text a form submitted under `name`, or '' when the field is missing or holds a file. */
export function textField(form: FormData, name: string): string {
  const value = form.get(name)
  return typeof value === 'string' ? value : ''
}
