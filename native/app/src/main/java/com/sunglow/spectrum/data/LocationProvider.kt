package com.sunglow.spectrum.data

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.location.Location
import android.location.LocationManager
import androidx.core.content.ContextCompat

/*
 * SUNGLOW · 定位
 * 只用系统 LocationManager 的「最后已知位置」，不引入 play-services，
 * 也不主动发起持续定位 —— 首次定位的耗时与耗电都不该花在这上面。
 */
class LocationProvider(context: Context) {

    private val appContext = context.applicationContext

    fun hasPermission(): Boolean =
        ContextCompat.checkSelfPermission(
            appContext, Manifest.permission.ACCESS_COARSE_LOCATION
        ) == PackageManager.PERMISSION_GRANTED ||
            ContextCompat.checkSelfPermission(
                appContext, Manifest.permission.ACCESS_FINE_LOCATION
            ) == PackageManager.PERMISSION_GRANTED

    /** 取各 provider 里最新的一个；没有权限或没有历史位置时返回 null */
    fun lastKnown(): LatLon? {
        if (!hasPermission()) return null
        val lm = appContext.getSystemService(Context.LOCATION_SERVICE) as? LocationManager ?: return null
        var best: Location? = null
        for (p in listOf(
            LocationManager.GPS_PROVIDER,
            LocationManager.NETWORK_PROVIDER,
            LocationManager.PASSIVE_PROVIDER
        )) {
            val l = try {
                lm.getLastKnownLocation(p)
            } catch (_: SecurityException) {
                null
            } catch (_: IllegalArgumentException) {
                null
            } ?: continue
            if (best == null || l.time > best.time) best = l
        }
        return best?.let { LatLon(it.latitude, it.longitude) }
    }
}
