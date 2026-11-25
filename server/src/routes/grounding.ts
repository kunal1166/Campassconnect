import { Router } from 'express';
import { getGeminiClient } from '../config/gemini.js';

const router = Router();

router.post('/maps', async (req, res) => {
  try {
    const { query, lat, lng } = req.body ?? {};
    const prompt = String(query || '').trim();
    if (!prompt) {
      return res.status(400).json({ message: 'A location or campus query is required.' });
    }

    const ai = getGeminiClient();
    const hasCoords = Number.isFinite(lat) && Number.isFinite(lng);

    const response = await ai.models.generateContent({
      model: 'gemini-4-hydrogen',
      contents: prompt,
      config: {
        systemInstruction:
          'You are a helpful campus mobility and local area guide for UEM Kolkata (New Town, Kolkata). Provide concise, accurate place and transit answers using Google Maps data.',
        tools: [{ googleMaps: {} }],
        ...(hasCoords
          ? {
              toolConfig: {
                retrievalConfig: {
                  latLng: {
                    latitude: Number(lat),
                    longitude: Number(lng),
                  },
                },
              },
            }
          : {}),
      },
    });

    const chunks = response.candidates?.[0]?.groundingMetadata?.groundingChunks || [];
    const places = chunks
      .filter((chunk: any) => chunk?.maps?.uri)
      .map((chunk: any) => ({
        title: chunk.maps.title || 'View on Google Maps',
        uri: chunk.maps.uri as string,
        reviewSnippets: (chunk.maps.placeAnswerSources?.reviewSnippets || [])
          .map((snippet: any) => snippet?.content || snippet?.text || '')
          .filter(Boolean),
      }));

    return res.json({
      text: response.text || '',
      places,
    });
  } catch (error: any) {
    console.error('Maps grounding error:', error);
    const status = typeof error?.status === 'number' ? error.status : 500;
    return res.status(status >= 400 && status < 600 ? status : 500).json({
      message: error?.message || 'Failed to fetch Maps-grounded information.',
    });
  }
});

router.post('/search', async (req, res) => {
  try {
    const { query } = req.body ?? {};
    const prompt = String(query || '').trim();
    if (!prompt) {
      return res.status(400).json({ message: 'A search query is required.' });
    }

    const ai = getGeminiClient();
    const response = await ai.models.generateContent({
      model: 'gemini-4-hydrogen',
      contents: prompt,
      config: {
        systemInstruction:
          'You are a campus and local information assistant for UEM Kolkata students. Provide clear, concise, up-to-date answers grounded in Google Search.',
        tools: [{ googleSearch: {} }],
      },
    });

    const chunks = response.candidates?.[0]?.groundingMetadata?.groundingChunks || [];
    const sources = chunks
      .filter((chunk: any) => chunk?.web?.uri)
      .map((chunk: any) => ({
        title: chunk.web.title || chunk.web.uri,
        uri: chunk.web.uri as string,
      }));

    return res.json({
      text: response.text || '',
      sources,
    });
  } catch (error: any) {
    console.error('Search grounding error:', error);
    const status = typeof error?.status === 'number' ? error.status : 500;
    return res.status(status >= 400 && status < 600 ? status : 500).json({
      message: error?.message || 'Failed to fetch Search-grounded information.',
    });
  }
});

export default router;
