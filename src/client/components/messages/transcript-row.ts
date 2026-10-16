/**
 * The transcript's column: centred, and 816px at most, which with a row's
 * 8px of padding either side is an 800px column of text. A ticket's title
 * and body sit in it too, so in a wide pane they line up with its activity.
 */
export const TRANSCRIPT_COLUMN_CLASS = "mx-auto w-full max-w-[816px]"

/**
 * The box every transcript row sits in (`TranscriptRowItem`): the column,
 * and padding that gives the jump highlight room and, with the margin under
 * it, sets the rhythm between messages: 8px of padding either side and 4px
 * of margin, 20px from one message to the next.
 *
 * A ticket's activity puts its rows in the same box, so it keeps the same
 * rhythm as the chat beside it.
 */
export const TRANSCRIPT_ROW_CLASS = `${TRANSCRIPT_COLUMN_CLASS} mb-1 rounded-xl p-2`
