import { http, HttpResponse } from 'msw'

export const handlers = [
  // Match the correct two-parameter pattern
  http.get(`${import.meta.env.VITE_BACKEND_API_URL}/slideimage/:presentationId/:pageObjectId`, ({ params }) => {
    console.log('MSW: Intercepting slideimage request with params:', params);
    
    const { pageObjectId } = params;
    
    // Return mock text content instead of image
    return HttpResponse.json({
      contentUrl: null,
      mockText: `Mock Slide Content for ${pageObjectId}`,
      width: 1920,
      height: 1080
    })
  }),
  
  // Also match if somehow only one param is being passed (debugging)
  http.get(`${import.meta.env.VITE_BACKEND_API_URL}/slideimage/:pageObjectId`, ({ params }) => {
    console.log('MSW: Intercepting slideimage request (single param) with params:', params);
    
    const { pageObjectId } = params;
    
    // Return mock text content instead of image
    return HttpResponse.json({
      contentUrl: null,
      mockText: `Mock Slide Content for ${pageObjectId}`,
      width: 1920,
      height: 1080
    })
  }),
]