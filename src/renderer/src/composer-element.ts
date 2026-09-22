/**
 * The composer's element id, in one place.
 *
 * It is a DOM contract between three things that otherwise have no reason to
 * know about each other: the composer declares it, window-level drag handling
 * uses it to tell "dropped on the composer" from "dropped somewhere else", and
 * the composer's own focus rule uses it to recognise focus that is already
 * inside. A second copy of the string is exactly how those three drift apart.
 */
export const COMPOSER_ELEMENT_ID = 'vespi-composer'
