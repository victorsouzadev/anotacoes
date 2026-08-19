package com.organizador.app.domain.common

import org.junit.Assert.assertEquals
import org.junit.Assert.assertSame
import org.junit.Test

class ListReorderTest {

    @Test
    fun `moving item forward shifts items in between back by one`() {
        assertEquals(listOf("b", "c", "a", "d"), listOf("a", "b", "c", "d").movedItem(from = 0, to = 2))
    }

    @Test
    fun `moving item backward shifts items in between forward by one`() {
        assertEquals(listOf("a", "d", "b", "c"), listOf("a", "b", "c", "d").movedItem(from = 3, to = 1))
    }

    @Test
    fun `moving item to itself is a no-op`() {
        val list = listOf("a", "b", "c")
        assertSame(list, list.movedItem(from = 1, to = 1))
    }

    @Test
    fun `moving the first item to the last position`() {
        assertEquals(listOf("b", "c", "d", "a"), listOf("a", "b", "c", "d").movedItem(from = 0, to = 3))
    }
}
