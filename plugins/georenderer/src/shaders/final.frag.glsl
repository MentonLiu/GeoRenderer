#version 300 es
precision highp float;
precision highp sampler2D;

uniform sampler2D uTex;
uniform int   uSharpenEnable;
uniform float uSharpenStrength;
uniform int   uGrainEnable;
uniform float uGrainStrength;
uniform float uGrainSeed;

out vec4 fragColor;

float hash(vec2 p) {
	vec3 p3 = fract(vec3(p.xyx) * 0.1031);
	p3 += dot(p3, p3.yzx + 33.33);
	return fract((p3.x + p3.y) * p3.z);
}

void main() {
	ivec2 px = ivec2(gl_FragCoord.xy);
	vec4 c = texelFetch(uTex, px, 0);
	vec3 color = c.rgb;

	if (uSharpenEnable == 1) {
		vec3 n = texelFetch(uTex, px + ivec2(0, 1), 0).rgb
			+ texelFetch(uTex, px + ivec2(0, -1), 0).rgb
			+ texelFetch(uTex, px + ivec2(1, 0), 0).rgb
			+ texelFetch(uTex, px + ivec2(-1, 0), 0).rgb;
		vec3 lap = color * 4.0 - n;
		color = clamp(color + uSharpenStrength * lap, 0.0, 1.0);
	}

	if (uGrainEnable == 1) {
		float n = hash(gl_FragCoord.xy + uGrainSeed) - 0.5;
		color = clamp(color + n * uGrainStrength, 0.0, 1.0);
	}

	fragColor = vec4(color, c.a);
}
