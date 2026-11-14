let pickedForThePerson = false;

/** Records that the address named no home and the app picked one itself. */
export function markHomePickedForThePerson(picked: boolean): void {
  pickedForThePerson = picked;
}

/** The address named no home: the app picked one (the last opened, or the default). */
export function homeWasPickedForThePerson(): boolean {
  return pickedForThePerson;
}
