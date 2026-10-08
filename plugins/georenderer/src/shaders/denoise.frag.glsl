#version 300 es
precision highp float;
precision highp sampler2D;

uniform sampler2D uColorIn;
uniform sampler2D uAlbedoTex;
uniform sampler2D uNormalTex;
uniform sampler2D uMomentTex;
uniform sampler2D uVarianceIn;
uniform int   uFirst;
uniform float uInvSpp;
uniform int   uStepSize;
uniform float uPhiColorBase;
uniform float uPhiNormal;
uniform float uPhiDepth;

layout(location = 0) out vec4 fragColor;
layout(location = 1) out float outVariance;

vec3 loadColor(ivec2 p, ivec2 size) {
	p = clamp(p, ivec2(0), size - 1);
	if (uFirst == 1) {
		vec3 c = texelFetch(uColorIn, p, 0).rgb * uInvSpp;
		vec3 a = max(texelFetch(uAlbedoTex, p, 0).rgb * uInvSpp, vec3(0.02));
		return c / a;
	}
	return texelFetch(uColorIn, p, 0).rgb;
}

float loadVariance(ivec2 p, ivec2 size) {
	p = clamp(p, ivec2(0), size - 1);
	if (uFirst == 1) {
		vec4 m = texelFetch(uMomentTex, p, 0) * uInvSpp;
		float perSample = max(m.y - m.x * m.x, 0.0);
		return perSample * uInvSpp;
	}
	return texelFetch(uVarianceIn, p, 0).r;
}

float loadDepth(ivec2 p, ivec2 size) {
	p = clamp(p, ivec2(0), size - 1);
	vec4 m = texelFetch(uMomentTex, p, 0);
	return m.w > 0.0 ? m.z / m.w : 1.0e6;
}

float kern(int d) {
	int i = d < 0 ? -d : d;
	if (i == 2) return 0.0625;
	if (i == 1) return 0.25;
	return 0.375;
}

void main() {
	ivec2 size = textureSize(uColorIn, 0);
	ivec2 px = ivec2(gl_FragCoord.xy);

	vec3 cp = loadColor(px, size);
	float varP = loadVariance(px, size);
	float depthP = loadDepth(px, size);
	float roughness = texelFetch(uAlbedoTex, px, 0).a * uInvSpp;
	// Preserve background texture detail instead of smoothing it with the model denoiser.
	// Mirror reflections already converge well; broad filtering would erase their detail.
	if (depthP >= 999999.0 || roughness < 0.1 || (roughness < 0.4 && uStepSize > 2)) {
		fragColor = vec4(cp, 1.0);
		outVariance = varP;
		return;
	}
	vec3 np = texelFetch(uNormalTex, px, 0).xyz;
	vec3 ap = texelFetch(uAlbedoTex, px, 0).rgb * uInvSpp;
	float materialP = texelFetch(uNormalTex, px, 0).a * uInvSpp;
	float nl = length(np);
	np = nl > 1e-6 ? np / nl : vec3(0.0, 1.0, 0.0);

	float phiColor = uPhiColorBase * mix(0.35, 1.0, smoothstep(0.1, 0.7, roughness)) * sqrt(max(varP, 0.0)) + 1e-4;

	vec3 sum = vec3(0.0);
	float wsum = 0.0;
	float varSum = 0.0;
	float varWsum = 0.0;
	for (int dy = -2; dy <= 2; dy++) {
		for (int dx = -2; dx <= 2; dx++) {
			ivec2 q = px + ivec2(dx, dy) * uStepSize;
			if (q.x < 0 || q.y < 0 || q.x >= size.x || q.y >= size.y) continue;
			vec3 cq = loadColor(q, size);
			float varQ = loadVariance(q, size);
			float depthQ = loadDepth(q, size);
			vec3 nq = texelFetch(uNormalTex, q, 0).xyz;
			vec3 aq = texelFetch(uAlbedoTex, q, 0).rgb * uInvSpp;
			float materialQ = texelFetch(uNormalTex, q, 0).a * uInvSpp;
			float ql = length(nq);
			nq = ql > 1e-6 ? nq / ql : vec3(0.0, 1.0, 0.0);

			vec3 dc = cp - cq;
			float wc = exp(-dot(dc, dc) / (phiColor * phiColor));
			float nd = max(0.0, 1.0 - dot(np, nq));
			float wn = exp(-nd * nd / max(uPhiNormal, 1e-5));
			float dd = abs(depthP - depthQ);
			float wd = (depthP > 1.0e5 || depthQ > 1.0e5) ? (dd < 1.0 ? 1.0 : 0.0)
				: exp(-dd * dd / max(uPhiDepth * depthP * depthP + 1e-6, 1e-6));
			// Material texture edges must remain boundaries even at high denoise strength.
			vec3 da = ap - aq;
			float wa = exp(-dot(da, da) / 0.0025);
			float wm = exp(-16.0 * abs(materialP - materialQ));
			float w = kern(dx) * kern(dy) * wc * wn * wd * wa * wm;
			sum += cq * w;
			wsum += w;
			varSum += varQ * w * w;
			varWsum += w;
		}
	}
	fragColor = vec4(wsum > 1e-8 ? sum / wsum : cp, 1.0);
	outVariance = varWsum > 1e-8 ? varSum / (varWsum * varWsum) : varP;
}
