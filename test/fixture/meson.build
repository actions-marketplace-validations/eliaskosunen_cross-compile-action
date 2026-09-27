project('cross_compile_fixture', 'c', 'cpp')

arch_macro = get_option('expected_arch_macro')
pointer_size = get_option('expected_pointer_size')
big_endian = get_option('expected_byte_order') == 'big' ? '1' : '0'

args = [
  '-DARCH_CHECK=' + arch_macro,
  '-DEXPECTED_POINTER_SIZE=' + pointer_size,
  '-DEXPECTED_BIG_ENDIAN=' + big_endian,
]
threads = dependency('threads')
libm = meson.get_compiler('c').find_library('m', required: false)

test('check_c', executable('check_c', 'check.c', c_args: args, dependencies: [threads, libm]))
test('check_cxx', executable('check_cxx', 'check.cpp', cpp_args: args, dependencies: threads))
