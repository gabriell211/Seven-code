cmake_minimum_required(VERSION 3.22.1)
project(seven_code_pty LANGUAGES C)
add_library(sevenpty SHARED seven_pty.c)
target_compile_features(sevenpty PRIVATE c_std_11)
target_compile_options(sevenpty PRIVATE -Wall -Wextra -Werror -fstack-protector-strong)
# Android 15/16 can run with 16 KiB memory pages. NDK r27 defaults to
# 4 KiB for manually linked JNI libraries unless these flags are explicit.
target_link_options(sevenpty PRIVATE
    "-Wl,-z,max-page-size=16384"
    "-Wl,-z,common-page-size=16384")
