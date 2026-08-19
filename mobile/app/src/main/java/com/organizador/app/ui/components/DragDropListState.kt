package com.organizador.app.ui.components

import androidx.compose.foundation.lazy.LazyListItemInfo
import androidx.compose.foundation.lazy.LazyListState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue

private val LazyListItemInfo.offsetEnd: Int get() = offset + size

/**
 * Backing state for a handle-driven drag-to-reorder [androidx.compose.foundation.lazy.LazyColumn].
 * A row's drag handle reports raw finger movement via [onDrag]; this class turns that into "which
 * visible row is the dragged one now hovering over" and invokes the move callback passed to
 * [onDrag] when it should swap places with a neighbor. [draggingItemOffset] — the visual
 * displacement to render the dragged row at — is recomputed from scratch every call (its original
 * slot + total drag distance, minus wherever the list has since laid it out), so it stays correct
 * across swaps without needing to be patched by hand.
 */
class DragDropListState(private val listState: LazyListState) {
    private var draggedDistance by mutableStateOf(0f)
    private var draggingItemInitialOffset = 0

    var draggingItemIndex by mutableStateOf<Int?>(null)
        private set

    val draggingItemOffset: Float
        get() = draggingItemLayoutInfo?.let { item ->
            draggingItemInitialOffset + draggedDistance - item.offset
        } ?: 0f

    private val draggingItemLayoutInfo: LazyListItemInfo?
        get() = listState.layoutInfo.visibleItemsInfo.firstOrNull { it.index == draggingItemIndex }

    fun onDragStart(index: Int) {
        val item = listState.layoutInfo.visibleItemsInfo.firstOrNull { it.index == index } ?: return
        draggingItemIndex = index
        draggingItemInitialOffset = item.offset
        draggedDistance = 0f
    }

    fun onDrag(deltaY: Float, onMove: (from: Int, to: Int) -> Unit) {
        draggedDistance += deltaY
        val draggingItem = draggingItemLayoutInfo ?: return
        val startOffset = draggingItem.offset + draggingItemOffset
        val middleOffset = startOffset + draggingItem.size / 2f

        val targetItem = listState.layoutInfo.visibleItemsInfo.firstOrNull { candidate ->
            candidate.index != draggingItem.index && middleOffset.toInt() in candidate.offset..candidate.offsetEnd
        }
        if (targetItem != null) {
            onMove(draggingItem.index, targetItem.index)
            draggingItemIndex = targetItem.index
        }
    }

    fun onDragEnd() {
        draggingItemIndex = null
        draggedDistance = 0f
    }
}

@Composable
fun rememberDragDropListState(listState: LazyListState): DragDropListState =
    remember(listState) { DragDropListState(listState) }
