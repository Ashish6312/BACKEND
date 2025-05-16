const crypto = require('crypto');
const axios = require('axios');
require('dotenv').config();

class LGPayService {    constructor() {
        this.appId = process.env.LGPAY_APP_ID.trim();
        this.tradeType = process.env.LGPAY_TRADE_TYPE.trim();
        this.secretKey = process.env.LGPAY_SECRET_KEY.trim();
        this.baseUrl = process.env.LGPAY_BASE_URL.trim();
        this.callbackUrl = process.env.LGPAY_CALLBACK_URL.trim();
        
        // Debug log environment variables
        console.log('LGPay Config:', {
            appId: this.appId,
            tradeType: this.tradeType,
            baseUrl: this.baseUrl,
            callbackUrl: this.callbackUrl
        });
    }

    generateOrderNumber() {
        return `ORDER${Date.now()}${Math.floor(Math.random() * 1000)}`;
    }    generateSignature(params) {
        // Remove empty values and sign parameter
        const cleanParams = Object.keys(params)
            .filter(key => {
                const value = params[key];
                return value !== undefined && 
                       value !== null && 
                       value !== '' && 
                       key !== 'sign';
            })
            .reduce((acc, key) => {
                acc[key] = String(params[key]).replace(/\s+/g, '');
                return acc;
            }, {});

        // Sort by ASCII values (0-9, a-z, A-Z)
        const sortedKeys = Object.keys(cleanParams).sort();
        
        // Create URL-style parameter string
        const paramsString = sortedKeys
            .map(key => `${key}=${cleanParams[key]}`)
            .join('&');
            
        // Add &key=secret_key to the end
        const signString = `${paramsString}&key=${this.secretKey}`;
        
        // Debug logs
        console.log('Clean params:', cleanParams);
        console.log('Params string:', paramsString);
        console.log('Final string to sign:', signString);
          // Generate MD5 hash and convert to uppercase
        return crypto.createHash('md5').update(signString).digest('hex').toUpperCase();
    }    async createOrder(amount, phone, ip = '0.0.0.0') {
        const orderSn = this.generateOrderNumber();
        const money = Math.round(amount * 100); // Convert to smallest currency unit and ensure it's an integer
        
        const params = {
            app_id: this.appId,
            trade_type: this.tradeType,
            order_sn: orderSn,
            money: money.toString(),
            notify_url: this.callbackUrl,
            ip: ip,
            remark: phone // Store phone in remark for reference
        };

        // Debug log the parameters
        console.log('Creating order with params:', { ...params, money_in_rupees: amount });

        // Generate signature
        params.sign = this.generateSignature(params);

        try {
            const response = await axios.post(`${this.baseUrl}/order/create`, new URLSearchParams(params).toString(), {
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded'
                }
            });

            if (response.data.status === 1) {
                return {
                    success: true,
                    orderId: orderSn,
                    payUrl: response.data.data.pay_url
                };
            } else {
                throw new Error(response.data.msg || 'Failed to create payment order');
            }
        } catch (error) {
            console.error('LG Pay Error:', error.response?.data || error.message);
            throw new Error(error.response?.data?.msg || error.message);
        }
    }

    verifyCallback(params) {
        const receivedSign = params.sign;
        const paramsToVerify = { ...params };
        delete paramsToVerify.sign;

        const calculatedSign = this.generateSignature(paramsToVerify);
        return receivedSign === calculatedSign;
    }
}

module.exports = new LGPayService();