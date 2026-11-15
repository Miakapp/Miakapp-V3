let pickedForThePerson = false;

/** Records that the address named no home and the app picked one itself. */
export function markHomePickedForThePerson(picked: boolean): void {
  pickedForThePerson = picked;
}

let noHomeYet = false;

/** Records that this browser has never opened a home and the address named none. */
export function markNoHomeYet(none: boolean): void {
  noHomeYet = none;
}

/** No home to open: the build default is a placeholder, not a home to show. */
export function hasNoHomeYet(): boolean {
  return noHomeYet;
}

/** The address named no home: the app picked one (the last opened, or the default). */
export function homeWasPickedForThePerson(): boolean {
  return pickedForThePerson;
}
