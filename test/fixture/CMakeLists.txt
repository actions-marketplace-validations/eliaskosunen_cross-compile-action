cmake_minimum_required(VERSION 3.21)

project(cross_compile_fixture LANGUAGES C CXX)

set(EXPECTED_ARCH_MACRO "" CACHE STRING "Preprocessor expression that is true only on the target, e.g. __aarch64__")
set(EXPECTED_POINTER_SIZE "" CACHE STRING "sizeof(void*) on the target")
set(EXPECTED_BYTE_ORDER "" CACHE STRING "little or big")

if(NOT EXPECTED_ARCH_MACRO OR NOT EXPECTED_POINTER_SIZE OR NOT EXPECTED_BYTE_ORDER MATCHES "^(little|big)$")
    message(FATAL_ERROR "EXPECTED_ARCH_MACRO, EXPECTED_POINTER_SIZE and EXPECTED_BYTE_ORDER must be set")
endif()

if(EXPECTED_BYTE_ORDER STREQUAL "big")
    set(expected_big_endian 1)
else()
    set(expected_big_endian 0)
endif()

enable_testing()

find_package(Threads REQUIRED)

foreach(check check_c check_cxx)
    if(check STREQUAL "check_c")
        add_executable(${check} check.c)
        target_link_libraries(${check} PRIVATE m)
    else()
        add_executable(${check} check.cpp)
    endif()
    target_compile_definitions(${check} PRIVATE
        ARCH_CHECK=${EXPECTED_ARCH_MACRO}
        EXPECTED_POINTER_SIZE=${EXPECTED_POINTER_SIZE}
        EXPECTED_BIG_ENDIAN=${expected_big_endian})
    target_link_libraries(${check} PRIVATE Threads::Threads)
    add_test(NAME ${check} COMMAND ${check})
endforeach()
