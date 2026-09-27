#include <math.h>
#include <stdint.h>
#include <stdio.h>
#include <string.h>

/* ARCH_CHECK is an expression like __aarch64__; undefined identifiers evaluate to 0 */
#if !(ARCH_CHECK)
#error "The compiler doesn't target the expected architecture"
#endif

_Static_assert(sizeof(void*) == EXPECTED_POINTER_SIZE, "Unexpected pointer size");

int main(void)
{
    const uint32_t value = 0x01020304;
    unsigned char bytes[sizeof(value)];
    memcpy(bytes, &value, sizeof(value));
    const int big_endian = bytes[0] == 0x01;
    if (big_endian != EXPECTED_BIG_ENDIAN) {
        fprintf(stderr, "Unexpected byte order at runtime\n");
        return 1;
    }

    volatile double two = 2.0;
    if (fabs(sqrt(two) * sqrt(two) - 2.0) > 1e-9) {
        fprintf(stderr, "sqrt(2.0) returned %f\n", sqrt(two));
        return 1;
    }

    printf("C: pointer size %zu, %s-endian\n", sizeof(void*), big_endian ? "big" : "little");
    return 0;
}
