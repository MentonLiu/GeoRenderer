#version 300 es
precision highp float;
precision highp sampler2D;

uniform sampler2D uAccumTex;
uniform sampler2D uDenoisedTex;
uniform sampler2D uAlbedoTex;
uniform float uInvSpp;
uniform int   uUseDenoise;
uniform float uExposure;

out vec4 fragColor;

void main() {
	ivec2 px = ivec2(gl_FragCoord.xy);
	vec4 acc = texelFetch(uAccumTex, px, 0);
	vec3 color;
	if (uUseDenoise == 1) {
		vec3 alb = max(texelFetch(uAlbedoTex, px, 0).rgb * uInvSpp, vec3(0.02));
		color = texelFetch(uDenoisedTex, px, 0).rgb * alb;
	} else {
		color = acc.rgb * uInvSpp;
	}
	float alpha = clamp(acc.a * uInvSpp, 0.0, 1.0);
	color = max(color, vec3(0.0)) * uExposure;
	fragColor = vec4(color, alpha);
}
