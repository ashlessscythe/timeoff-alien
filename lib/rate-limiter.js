'use strict'

class RateLimiter {
  constructor(requestsPerSecond, options = {}) {
    this.requestsPerSecond = requestsPerSecond
    this.maxQueueSize = options.maxQueueSize || 100
    this.queue = []
    this.processing = false
    this.lastProcessedTime = Date.now()
  }

  async add(fn) {
    if (this.queue.length >= this.maxQueueSize) {
      throw new Error('Rate limiter queue is full')
    }

    return new Promise((resolve, reject) => {
      this.queue.push({
        fn,
        resolve,
        reject,
        addedAt: Date.now()
      })
      this.process()
    })
  }

  async process() {
    if (this.processing) return
    this.processing = true

    try {
      while (this.queue.length > 0) {
        const now = Date.now()
        const timeSinceLastProcess = now - this.lastProcessedTime
        const minTimeBetweenRequests = 1000 / this.requestsPerSecond

        // If we need to wait to maintain rate limit, do so
        if (timeSinceLastProcess < minTimeBetweenRequests) {
          await new Promise(resolve =>
            setTimeout(resolve, minTimeBetweenRequests - timeSinceLastProcess)
          )
        }

        const request = this.queue[0]
        const timeInQueue = Date.now() - request.addedAt

        // If request has been in queue too long, reject it
        if (timeInQueue > 30000) {
          // 30 second timeout
          this.queue.shift()
          request.reject(new Error('Request timeout - too long in queue'))
          continue
        }

        try {
          const result = await request.fn()
          request.resolve(result)
        } catch (error) {
          request.reject(error)
        }

        this.queue.shift()
        this.lastProcessedTime = Date.now()
      }
    } catch (error) {
      console.error('Error in rate limiter process:', error)
    } finally {
      this.processing = false
    }
  }

  // Helper method to get queue stats
  getStats() {
    return {
      queueLength: this.queue.length,
      isProcessing: this.processing,
      maxQueueSize: this.maxQueueSize
    }
  }
}

module.exports = RateLimiter
