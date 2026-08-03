package com.appmobile.push.store

interface KeyValueStore {
    fun getString(key: String): String?

    fun putString(key: String, value: String)

    fun remove(key: String)
}
