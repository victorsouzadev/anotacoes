package com.organizador.app.ui.common

import androidx.compose.runtime.Composable
import androidx.compose.ui.res.stringResource
import com.organizador.app.R
import java.time.DayOfWeek

@Composable
fun weekdayShortLabel(day: DayOfWeek): String = when (day) {
    DayOfWeek.MONDAY -> stringResource(R.string.weekday_mon)
    DayOfWeek.TUESDAY -> stringResource(R.string.weekday_tue)
    DayOfWeek.WEDNESDAY -> stringResource(R.string.weekday_wed)
    DayOfWeek.THURSDAY -> stringResource(R.string.weekday_thu)
    DayOfWeek.FRIDAY -> stringResource(R.string.weekday_fri)
    DayOfWeek.SATURDAY -> stringResource(R.string.weekday_sat)
    DayOfWeek.SUNDAY -> stringResource(R.string.weekday_sun)
}
