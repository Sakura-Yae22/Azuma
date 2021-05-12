const { resolve } = require('path');
const { Util } = require('discord.js');
const AsyncQueue = require(resolve(require.resolve('discord.js').replace('index.js', '/rest/AsyncQueue.js')));

class RatelimitQueue {
    constructor(manager, id, endpoint) {
        this.manager = manager;
        this.id = id;
        this.endpoint = endpoint;
        this.limit = -1;
        this.remaining = -1;
        this.reset = -1;
        this.after = -1;
        this.queue = new AsyncQueue();
    }

    static rateLimitBuilder(headers) {
        if (!headers) throw new Error('Headers can\'t be null');
        return {
            date: headers.get('date'),
            limit: headers.get('x-ratelimit-limit'),
            remaining: headers.get('x-ratelimit-remaining'),
            reset: headers.get('x-ratelimit-reset'),
            hash: headers.get('X-RateLimit-Bucket'),
            after: headers.get('retry-after'),
            global: !!headers.get('x-ratelimit-global')
        };
    }

    static getAPIOffset(date) {
        return new Date(date).getTime() - Date.now();
    }

    static calculateReset(reset, date) {
        return new Date(Number(reset) * 1000).getTime() - RatelimitQueue.getAPIOffset(date);
    }
    
    get limited() {
        return !!this.manager.timeout || this.remaining <= 0 && Date.now() < this.reset;
    }
    
    get timeout() {
        return this.reset + this.manager.wa2000.sweepInterval - Date.now();
    }

    get inactive() {
        return this.queue.remaining === 0 && !this.limited;
    }

    async update({ date, limit, remaining, reset, after, global, reactions } = {}) {
        // Set or Update, This queue ratelimit data.
        this.limit = !isNaN(limit) ? Number(limit) : Infinity;
        this.remaining = !isNaN(remaining) ? Number(remaining) : -1;
        this.reset = !isNaN(reset) ? RatelimitQueue.calculateReset(reset, date) : Date.now();
        this.after = !isNaN(after) ? Number(after) * 1000 : -1;
        // https://github.com/discordapp/discord-api-docs/issues/182
        if (reactions) 
            this.reset = new Date(date).getTime() - RatelimitQueue.getAPIOffset(date) + this.manager.wa2000.sweepInterval;
        // Global ratelimit, will halt all the requests if this is true
        if (global) {
            this.manager.timeout = Util.delayFor(this.after);
            await this.manager.timeout;
            this.manager.timeout = null;
        }
    }

    async handle() {
        await this.queue.wait();
        try {
            await this.wait();
        } finally {
            this.queue.shift();
        }
    }

    // This is a private method just dont call it
    wait() {
        // Rejoice you can still do your query
        if (!this.limited) return Util.delayFor(0);
        // Emit ratelimit event
        this.manager.wa2000.emit('ratelimit', {
            base: this.manager.base,
            endpoint: this.endpoint, 
            bucket: this.id, 
            limit: this.limit, 
            remaining: this.remaining, 
            after: this.after, 
            timeout: this.timeout,
            global: !!this.manager.timeout
        });
        // If this exists, means we hit global timeout, on other request that isn't in this endpoint
        if (this.manager.timeout) return this.manager.timeout;
        // if not then just calculate the timeout in this route then wait it out
        return Util.delayFor(this.timeout);
    }
}

module.exports = RatelimitQueue;