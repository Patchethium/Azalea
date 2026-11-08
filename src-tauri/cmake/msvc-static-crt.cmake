# Toolchain file for CMake-built dependencies (OpenJTalk) on Windows MSVC.
# CMake 3.15+ picks the runtime from CMAKE_MSVC_RUNTIME_LIBRARY and ignores the
# /MT flag cmake-rs passes, so select the static runtime here to match
# `+crt-static` in .cargo/config.toml.
set(CMAKE_MSVC_RUNTIME_LIBRARY "MultiThreaded")
