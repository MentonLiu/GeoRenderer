#version 300 es
precision highp float;
precision highp sampler2D;

uniform sampler2D uHDR;
uniform sampler2D uBloomTex;
uniform int   uUseBloom;
uniform float uBloomIntensity;
uniform float uContrast;
uniform float uSaturation;
uniform int   uToneMap;
uniform int   uVignetteEnable;
uniform float uVignetteStrength;
uniform vec2  uResolution;
uniform vec2  uTileOrigin;

out vec4 fragColor;

vec3 tmReinhard(vec3 c) { return c / (1.0 + c); }

vec3 tmACES(vec3 x) {
	const float a = 2.51, b = 0.03, c = 2.43, d = 0.59, e = 0.14;
	return clamp((x * (a * x + b)) / (x * (c * x + d) + e), 0.0, 1.0);
}

vec3 uncharted2(vec3 x) {
	const float A = 0.15, B = 0.50, C = 0.10, D = 0.20, E = 0.02, F = 0.30;
	return ((x * (A * x + C * B) + D * E) / (x * (A * x + B) + D * F)) - E / F;
}
vec3 tmFilmic(vec3 c) {
	vec3 w = uncharted2(vec3(11.2));
	return clamp(uncharted2(c * 2.0) / w, 0.0, 1.0);
}

vec3 tmAgX(vec3 c) {
	c = max(c, vec3(0.0));
	const mat3 inSet = mat3(
		0.842479062253094, 0.0423282422610123, 0.0423756549057051,
		0.0784335999999992, 0.878468636469772, 0.0784336000000000,
		0.0792237451477643, 0.0791661274605434, 0.879142973793104);
	const mat3 outSet = mat3(
		1.19687900512017, -0.0528968517574562, -0.0529716355144438,
		-0.0980208811401368, 1.15190312990417, -0.0980434501171241,
		-0.0990297440797205, -0.0989611768448433, 1.15107367264116);
	c = inSet * c;
	c = clamp((log2(max(c, vec3(1e-10))) + 12.47393) / (12.47393 + 4.026069), 0.0, 1.0);
	vec3 x = c;
	vec3 x2 = x * x;
	vec3 x4 = x2 * x2;
	c = 15.5 * x4 * x2 - 40.14 * x4 * x + 31.96 * x4 - 6.868 * x2 * x + 0.4298 * x2 + 0.1191 * x - 0.00232;
	c = outSet * c;
	return clamp(c, 0.0, 1.0);
}

vec3 linearToSRGB(vec3 c) {
	c = clamp(c, 0.0, 1.0);
	return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(vec3(0.0031308), c));
}

void main() {
	ivec2 px = ivec2(gl_FragCoord.xy);
	vec4 hdr = texelFetch(uHDR, px, 0);
	vec3 color = hdr.rgb;
	if (uUseBloom == 1) color += texelFetch(uBloomTex, px, 0).rgb * uBloomIntensity;

	if (uToneMap == 1) color = tmReinhard(color);
	else if (uToneMap == 2) color = tmACES(color);
	else if (uToneMap == 3) color = tmFilmic(color);
	else if (uToneMap == 4) color = tmAgX(color);
	else color = clamp(color, 0.0, 1.0);

	float l = dot(color, vec3(0.2126, 0.7152, 0.0722));
	color = mix(vec3(l), color, uSaturation);
	color = clamp((color - 0.5) * uContrast + 0.5, 0.0, 1.0);

	if (uVignetteEnable == 1) {
		vec2 uv = ((gl_FragCoord.xy + uTileOrigin) / uResolution) * 2.0 - 1.0;
		float d = clamp(dot(uv, uv) * 0.5, 0.0, 1.0);
		color *= clamp(1.0 - uVignetteStrength * d, 0.0, 1.0);
	}

	fragColor = vec4(linearToSRGB(color), hdr.a);
}
