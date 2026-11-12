/*
 * SUNGLOW 原生安卓 App · Gradle 设置
 * 单模块（:app）结构：MVP 阶段拆模块无收益。
 * 依赖版本统一在 gradle/libs.versions.toml 里管理。
 */
pluginManagement {
    repositories {
        google {
            content {
                includeGroupByRegex("com\\.android.*")
                includeGroupByRegex("com\\.google.*")
                includeGroupByRegex("androidx.*")
            }
        }
        mavenCentral()
        gradlePluginPortal()
    }
}

dependencyResolutionManagement {
    repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)
    repositories {
        google()
        mavenCentral()
    }
}

rootProject.name = "SunglowSpectrum"
include(":app")
