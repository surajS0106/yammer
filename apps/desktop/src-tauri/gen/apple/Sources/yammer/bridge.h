// The Rust functions Swift calls, from src/ios/mod.rs. Dictation.swift's @_cdecl
// functions are the other direction, and src/ios/mod.rs declares those.
#pragma once

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

void yammer_ios_process(const float *samples, size_t len, uint32_t rate);
void yammer_ios_recording(bool on);
void yammer_ios_level(float rms);
void yammer_ios_failed(const char *message);
