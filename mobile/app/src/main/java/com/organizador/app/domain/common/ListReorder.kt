package com.organizador.app.domain.common

/** Returns a new list with the item at [from] moved to [to]; a no-op copy when the indices already match. */
fun <T> List<T>.movedItem(from: Int, to: Int): List<T> {
    if (from == to) return this
    val mutable = toMutableList()
    mutable.add(to, mutable.removeAt(from))
    return mutable
}
