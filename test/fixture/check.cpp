#include <cmath>
#include <cstdint>
#include <cstring>
#include <iostream>
#include <stdexcept>
#include <string>
#include <thread>

#if !(ARCH_CHECK)
#error "The compiler doesn't target the expected architecture"
#endif

static_assert(sizeof(void*) == EXPECTED_POINTER_SIZE, "Unexpected pointer size");

int main()
{
    const std::uint32_t value = 0x01020304;
    unsigned char bytes[sizeof(value)];
    std::memcpy(bytes, &value, sizeof(value));
    const bool big_endian = bytes[0] == 0x01;
    if (big_endian != static_cast<bool>(EXPECTED_BIG_ENDIAN)) {
        std::cerr << "Unexpected byte order at runtime\n";
        return 1;
    }

    std::string message;
    try {
        throw std::runtime_error("exceptions work");
    }
    catch (const std::exception& e) {
        message = e.what();
    }

    std::thread thread([&] { message += ", threads work"; });
    thread.join();

    volatile double two = 2.0;
    if (std::abs(std::sqrt(two) * std::sqrt(two) - 2.0) > 1e-9) {
        std::cerr << "std::sqrt(2.0) returned " << std::sqrt(two) << '\n';
        return 1;
    }

    std::cout << "C++: " << message << ", pointer size " << sizeof(void*) << ", "
              << (big_endian ? "big" : "little") << "-endian\n";
}
